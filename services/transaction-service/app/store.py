"""
SQLAlchemy-backed transaction store for the Transaction Service.

Persists users, transactions, events, and idempotency keys to SQLite
(`upi_simulator.db`), ensuring data survives application and container restarts.
Includes automatic lightweight schema migration for existing SQLite files.
"""
import json
import os
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import create_engine, select, func
from sqlalchemy.orm import sessionmaker, scoped_session

from app.models import Base, UserModel, TransactionModel, TransactionEventModel

_DEFAULT_DB_DIR = Path(__file__).resolve().parent.parent / "data"
DB_PATH = os.getenv("SQLITE_DB_PATH", str(_DEFAULT_DB_DIR / "upi_simulator.db"))
DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{DB_PATH}")

db_dir = Path(DB_PATH).parent
db_dir.mkdir(parents=True, exist_ok=True)

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False},
    echo=False,
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
db_session = scoped_session(SessionLocal)

# Mirrors for backward compatibility
USERS: list[dict] = []
TRANSACTIONS: dict[str, dict] = {}
IDEMPOTENCY_KEYS: dict[str, str] = {}


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def migrate_db_schema():
    """
    Inspect existing SQLite tables and execute ALTER TABLE statements
    to migrate old schema columns safely without deleting data.
    """
    if not os.path.exists(DB_PATH):
        return

    conn = sqlite3.connect(DB_PATH)
    try:
        cursor = conn.cursor()

        # 1. Check users table columns
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='users'")
        if cursor.fetchone():
            cursor.execute("PRAGMA table_info(users)")
            user_cols = {row[1] for row in cursor.fetchall()}
            if "upi_id" not in user_cols:
                cursor.execute("ALTER TABLE users ADD COLUMN upi_id VARCHAR(100)")
            if "bank_name" not in user_cols:
                cursor.execute("ALTER TABLE users ADD COLUMN bank_name VARCHAR(100)")
            if "created_at" not in user_cols:
                cursor.execute("ALTER TABLE users ADD COLUMN created_at VARCHAR(50)")

            cursor.execute("UPDATE users SET upi_id = id WHERE upi_id IS NULL OR upi_id = ''")
            cursor.execute("UPDATE users SET bank_name = 'HDFC Bank' WHERE bank_name IS NULL OR bank_name = ''")
            cursor.execute(
                "UPDATE users SET created_at = ? WHERE created_at IS NULL OR created_at = ''",
                (datetime.now(timezone.utc).isoformat(),),
            )

        # 2. Check transactions table columns
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='transactions'")
        if cursor.fetchone():
            cursor.execute("PRAGMA table_info(transactions)")
            txn_cols = {row[1] for row in cursor.fetchall()}

            if "sender_upi" not in txn_cols:
                cursor.execute("ALTER TABLE transactions ADD COLUMN sender_upi VARCHAR(100)")
            if "receiver_upi" not in txn_cols:
                cursor.execute("ALTER TABLE transactions ADD COLUMN receiver_upi VARCHAR(100)")
            if "sender_id" not in txn_cols:
                cursor.execute("ALTER TABLE transactions ADD COLUMN sender_id VARCHAR(100)")
            if "receiver_id" not in txn_cols:
                cursor.execute("ALTER TABLE transactions ADD COLUMN receiver_id VARCHAR(100)")

            if "sender_id" in txn_cols:
                cursor.execute("UPDATE transactions SET sender_upi = sender_id WHERE sender_upi IS NULL")
                cursor.execute("UPDATE transactions SET sender_id = sender_upi WHERE sender_id IS NULL")
            if "receiver_id" in txn_cols:
                cursor.execute("UPDATE transactions SET receiver_upi = receiver_id WHERE receiver_upi IS NULL")
                cursor.execute("UPDATE transactions SET receiver_id = receiver_upi WHERE receiver_id IS NULL")

            if "idempotency_key" not in txn_cols:
                cursor.execute("ALTER TABLE transactions ADD COLUMN idempotency_key VARCHAR(100)")
                cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='idempotency_keys'")
                if cursor.fetchone():
                    cursor.execute(
                        """
                        UPDATE transactions 
                        SET idempotency_key = (
                            SELECT idempotency_key FROM idempotency_keys 
                            WHERE idempotency_keys.transaction_id = transactions.transaction_id
                        ) WHERE idempotency_key IS NULL
                        """
                    )

        # 3. Check transaction_events table columns
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='transaction_events'")
        if cursor.fetchone():
            cursor.execute("PRAGMA table_info(transaction_events)")
            evt_cols = {row[1] for row in cursor.fetchall()}
            if "event_type" not in evt_cols:
                cursor.execute("ALTER TABLE transaction_events ADD COLUMN event_type VARCHAR(100)")
            if "event" not in evt_cols:
                cursor.execute("ALTER TABLE transaction_events ADD COLUMN event VARCHAR(100)")

            if "event" in evt_cols:
                cursor.execute("UPDATE transaction_events SET event_type = event WHERE event_type IS NULL")
                cursor.execute("UPDATE transaction_events SET event = event_type WHERE event IS NULL")

            if "service_name" not in evt_cols:
                cursor.execute("ALTER TABLE transaction_events ADD COLUMN service_name VARCHAR(100)")
                cursor.execute(
                    "UPDATE transaction_events SET service_name = 'Transaction Service' WHERE service_name IS NULL"
                )
            if "message" not in evt_cols:
                cursor.execute("ALTER TABLE transaction_events ADD COLUMN message TEXT")
                cursor.execute("UPDATE transaction_events SET message = event_type WHERE message IS NULL")

        conn.commit()
    except Exception as exc:
        conn.rollback()
    finally:
        conn.close()


def init_db() -> None:
    """Migrate schema, create tables, and seed default users idempotently."""
    migrate_db_schema()
    Base.metadata.create_all(bind=engine)

    session = SessionLocal()
    try:
        seed_users = [
            {"id": "usr_sanika", "name": "Sanika", "upi_id": "sanika@bank", "bank_name": "HDFC Bank", "balance": 10000.0},
            {"id": "usr_navya", "name": "Navya", "upi_id": "navya@bank", "bank_name": "ICICI Bank", "balance": 5000.0},
            {"id": "usr_rahul", "name": "Rahul", "upi_id": "rahul@bank", "bank_name": "SBI Bank", "balance": 7500.0},
            {"id": "usr_priya", "name": "Priya", "upi_id": "priya@bank", "bank_name": "Axis Bank", "balance": 12000.0},
            {"id": "sanika@bank", "name": "Sanika", "upi_id": "sanika@bank", "bank_name": "HDFC Bank", "balance": 10000.0},
            {"id": "navya@bank", "name": "Navya", "upi_id": "navya@bank", "bank_name": "ICICI Bank", "balance": 5000.0},
            {"id": "rahul@bank", "name": "Rahul", "upi_id": "rahul@bank", "bank_name": "SBI Bank", "balance": 7500.0},
            {"id": "priya@bank", "name": "Priya", "upi_id": "priya@bank", "bank_name": "Axis Bank", "balance": 12000.0},
            {"id": "saba@bank", "name": "Saba", "upi_id": "saba@bank", "bank_name": "SBI Bank", "balance": 7500.0},
            {"id": "manaswi@bank", "name": "Manaswi", "upi_id": "manaswi@bank", "bank_name": "Axis Bank", "balance": 12000.0},
            {"id": "sai@bank", "name": "Sai", "upi_id": "sai@bank", "bank_name": "PNB Bank", "balance": 15000.0},
            {"id": "sanika", "name": "Sanika", "upi_id": "sanika@bank", "bank_name": "HDFC Bank", "balance": 10000.0},
            {"id": "navya", "name": "Navya", "upi_id": "navya@bank", "bank_name": "ICICI Bank", "balance": 5000.0},
            {"id": "rahul", "name": "Rahul", "upi_id": "rahul@bank", "bank_name": "SBI Bank", "balance": 7500.0},
            {"id": "priya", "name": "Priya", "upi_id": "priya@bank", "bank_name": "Axis Bank", "balance": 12000.0},
            {"id": "saba", "name": "Saba", "upi_id": "saba@bank", "bank_name": "SBI Bank", "balance": 7500.0},
            {"id": "manaswi", "name": "Manaswi", "upi_id": "manaswi@bank", "bank_name": "Axis Bank", "balance": 12000.0},
            {"id": "sai", "name": "Sai", "upi_id": "sai@bank", "bank_name": "PNB Bank", "balance": 15000.0},
        ]

        for u_data in seed_users:
            existing = session.query(UserModel).filter(UserModel.id == u_data["id"]).first()
            if not existing:
                u_model = UserModel(
                    id=u_data["id"],
                    name=u_data["name"],
                    upi_id=u_data["upi_id"],
                    bank_name=u_data["bank_name"],
                    balance=u_data["balance"],
                    created_at=datetime.now(timezone.utc).isoformat(),
                )
                session.add(u_model)
        session.commit()
    finally:
        session.close()


def list_users() -> list[dict]:
    """Query live user list directly from SQLite."""
    session = SessionLocal()
    try:
        users = session.query(UserModel).all()
        seen_upi = set()
        result = []
        # Preferred order of users for clean UI presentation
        user_order = ["usr_sanika", "usr_navya", "usr_rahul", "usr_priya"]
        
        # Sort so preferred internal user IDs come first
        users_sorted = sorted(
            users,
            key=lambda u: user_order.index(u.id) if u.id in user_order else 99
        )
        
        for u in users_sorted:
            upi = u.upi_id or u.id
            if upi in seen_upi:
                continue
            seen_upi.add(upi)
            result.append({
                "id": u.id,
                "name": u.name,
                "upi_id": upi,
                "bank": u.bank_name or "Demo Bank",
                "bank_name": u.bank_name or "Demo Bank",
                "balance": float(u.balance),
            })
        return result
    finally:
        session.close()


def get_user_by_id_or_upi(identifier: str) -> dict | None:
    if not identifier:
        return None
    identifier = identifier.strip()
    if "/" in identifier:
        parts = [p.strip() for p in identifier.split("/")]
        for p in reversed(parts):
            res = get_user_by_id_or_upi(p)
            if res:
                return res
        for p in parts:
            res = get_user_by_id_or_upi(p)
            if res:
                return res
        identifier = parts[-1]

    session = SessionLocal()
    try:
        u = (
            session.query(UserModel)
            .filter((UserModel.id == identifier) | (UserModel.upi_id == identifier) | (UserModel.name == identifier))
            .first()
        )
        if not u and "@" in identifier:
            base = identifier.split("@")[0]
            u = (
                session.query(UserModel)
                .filter((UserModel.id == base) | (UserModel.upi_id == base) | (UserModel.id == f"usr_{base}") | (UserModel.name.ilike(base)))
                .first()
            )
        if not u and identifier.startswith("usr_"):
            base = identifier[4:]
            u = (
                session.query(UserModel)
                .filter((UserModel.id == base) | (UserModel.upi_id == f"{base}@bank") | (UserModel.upi_id == base))
                .first()
            )
        if not u:
            u = session.query(UserModel).filter(UserModel.name.ilike(identifier)).first()
        if not u:
            return None
        return {
            "id": u.id,
            "name": u.name,
            "upi_id": u.upi_id or u.id,
            "bank_name": u.bank_name or "Demo Bank",
            "bank": u.bank_name or "Demo Bank",
            "balance": float(u.balance),
        }
    finally:
        session.close()


def update_user_balances(sender_identifier: str, receiver_identifier: str, amount: float):
    """Reflect successful transfer in transaction-service users table balances."""
    session = SessionLocal()
    try:
        sender_base = sender_identifier.replace("usr_", "").split("@")[0]
        senders = (
            session.query(UserModel)
            .filter(
                (UserModel.id == sender_identifier)
                | (UserModel.upi_id == sender_identifier)
                | (UserModel.id == f"usr_{sender_base}")
                | (UserModel.id == sender_base)
                | (UserModel.upi_id == f"{sender_base}@bank")
            )
            .all()
        )
        for s in senders:
            s.balance = max(0.0, float(s.balance) - amount)

        receiver_base = receiver_identifier.replace("usr_", "").split("@")[0]
        receivers = (
            session.query(UserModel)
            .filter(
                (UserModel.id == receiver_identifier)
                | (UserModel.upi_id == receiver_identifier)
                | (UserModel.id == f"usr_{receiver_base}")
                | (UserModel.id == receiver_base)
                | (UserModel.upi_id == f"{receiver_base}@bank")
            )
            .all()
        )
        for r in receivers:
            r.balance = float(r.balance) + amount

        session.commit()
    except Exception:
        session.rollback()
    finally:
        session.close()


def _row_to_dict(txn_model: TransactionModel, session) -> dict:
    events = (
        session.query(TransactionEventModel)
        .filter(TransactionEventModel.transaction_id == txn_model.transaction_id)
        .order_by(TransactionEventModel.id.asc())
        .all()
    )

    timeline = [
        {
            "event": e.event_type or e.event,
            "service": e.service_name or "Transaction Service",
            "message": e.message or e.event_type or e.event,
            "timestamp": e.timestamp,
        }
        for e in events
    ]

    return {
        "transactionId": txn_model.transaction_id,
        "senderId": txn_model.sender_upi or txn_model.sender_id,
        "receiverId": txn_model.receiver_upi or txn_model.receiver_id,
        "amount": txn_model.amount,
        "status": txn_model.status,
        "failureReason": txn_model.failure_reason,
        "idempotencyKey": txn_model.idempotency_key,
        "timeline": timeline,
        "createdAt": txn_model.created_at,
        "updatedAt": txn_model.updated_at,
    }


def get_transaction(transaction_id: str) -> dict | None:
    session = SessionLocal()
    try:
        txn = (
            session.query(TransactionModel)
            .filter(TransactionModel.transaction_id == transaction_id)
            .first()
        )
        if not txn:
            return None
        return _row_to_dict(txn, session)
    finally:
        session.close()


def get_transaction_by_idempotency_key(idempotency_key: str) -> dict | None:
    if not idempotency_key:
        return None
    session = SessionLocal()
    try:
        txn = (
            session.query(TransactionModel)
            .filter(TransactionModel.idempotency_key == idempotency_key)
            .first()
        )
        if not txn:
            return None
        return _row_to_dict(txn, session)
    finally:
        session.close()


def new_transaction(sender_upi: str, receiver_upi: str, amount: float, idempotency_key: str | None = None) -> dict:
    txn_id = f"TXN-{datetime.now().strftime('%Y%m%d')}-{uuid.uuid4().hex[:6].upper()}"
    now = datetime.now(timezone.utc).isoformat()

    session = SessionLocal()
    try:
        txn_model = TransactionModel(
            transaction_id=txn_id,
            sender_upi=sender_upi,
            receiver_upi=receiver_upi,
            sender_id=sender_upi,
            receiver_id=receiver_upi,
            amount=amount,
            status="INITIATED",
            failure_reason=None,
            idempotency_key=idempotency_key,
            created_at=now,
            updated_at=now,
        )
        session.add(txn_model)
        session.commit()
        session.refresh(txn_model)

        return _row_to_dict(txn_model, session)
    finally:
        session.close()


def record_timeline(txn: dict, event_type: str, service_name: str = "Transaction Service", message: str = "", **extra):
    timestamp = datetime.now(timezone.utc).isoformat()
    txn_id = txn["transactionId"]

    session = SessionLocal()
    try:
        event_model = TransactionEventModel(
            transaction_id=txn_id,
            event_type=event_type,
            event=event_type,
            service_name=service_name,
            message=message or extra.get("reason") or extra.get("detail") or event_type.replace("_", " "),
            timestamp=timestamp,
        )
        session.add(event_model)

        txn_model = session.query(TransactionModel).filter(TransactionModel.transaction_id == txn_id).first()
        if txn_model:
            txn_model.updated_at = timestamp

        session.commit()
    finally:
        session.close()

    entry = {
        "event": event_type,
        "service": service_name,
        "message": message,
        "timestamp": timestamp,
        **extra,
    }
    txn["timeline"].append(entry)
    txn["updatedAt"] = timestamp


def set_status(txn: dict, status: str, failure_reason: str | None = None):
    timestamp = datetime.now(timezone.utc).isoformat()
    txn_id = txn["transactionId"]
    txn["status"] = status
    if failure_reason is not None:
        txn["failureReason"] = failure_reason
    txn["updatedAt"] = timestamp

    session = SessionLocal()
    try:
        txn_model = session.query(TransactionModel).filter(TransactionModel.transaction_id == txn_id).first()
        if txn_model:
            txn_model.status = status
            if failure_reason is not None:
                txn_model.failure_reason = failure_reason
            txn_model.updated_at = timestamp
            session.commit()
    finally:
        session.close()


def list_transactions(status_filter: str | None = None) -> list[dict]:
    session = SessionLocal()
    try:
        query = session.query(TransactionModel)
        if status_filter and status_filter.upper() != "ALL":
            query = query.filter(TransactionModel.status == status_filter.upper())
        
        txns = query.order_by(TransactionModel.created_at.desc()).all()
        return [_row_to_dict(t, session) for t in txns]
    finally:
        session.close()


def get_stats() -> dict:
    """Return database-derived transaction statistics."""
    session = SessionLocal()
    try:
        total = session.query(TransactionModel).count()
        successful = session.query(TransactionModel).filter(TransactionModel.status == "SUCCESS").count()
        failed = session.query(TransactionModel).filter(TransactionModel.status == "FAILED").count()
        processing = total - (successful + failed)
        return {
            "total": total,
            "successful": successful,
            "failed": failed,
            "processing": max(0, processing),
        }
    finally:
        session.close()
