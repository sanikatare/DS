"""
SQLAlchemy persistence for Sender Bank account balances and debit records.
Database File: sender_bank.db
"""
import os
from pathlib import Path
from sqlalchemy import create_engine, Column, String, Float
from sqlalchemy.orm import declarative_base, sessionmaker, scoped_session

_DEFAULT_DB_DIR = Path(__file__).resolve().parent.parent / "data"
DB_PATH = os.getenv("SQLITE_DB_PATH", str(_DEFAULT_DB_DIR / "sender_bank.db"))
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

Base = declarative_base()


import sqlite3

class AccountModel(Base):
    __tablename__ = "accounts"

    id = Column(String(50), primary_key=True)
    name = Column(String(100), nullable=False)
    upi_id = Column(String(100), nullable=True)
    balance = Column(Float, nullable=False, default=0.0)


class DebitModel(Base):
    __tablename__ = "debits"

    transaction_id = Column(String(50), primary_key=True)
    sender_id = Column(String(100), nullable=False)
    amount = Column(Float, nullable=False)


def migrate_db_schema():
    if not os.path.exists(DB_PATH):
        return
    conn = sqlite3.connect(DB_PATH)
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='accounts'")
        if cursor.fetchone():
            cursor.execute("PRAGMA table_info(accounts)")
            cols = {row[1] for row in cursor.fetchall()}
            if "upi_id" not in cols:
                cursor.execute("ALTER TABLE accounts ADD COLUMN upi_id VARCHAR(100)")
        conn.commit()
    except Exception:
        conn.rollback()
    finally:
        conn.close()


def init_db() -> None:
    """Create database tables and seed default accounts on first run."""
    migrate_db_schema()
    Base.metadata.create_all(bind=engine)
    session = SessionLocal()
    try:
        default_accounts = [
            AccountModel(id="usr_sanika", name="Sanika", upi_id="sanika@bank", balance=10000.0),
            AccountModel(id="usr_navya", name="Navya", upi_id="navya@bank", balance=5000.0),
            AccountModel(id="usr_rahul", name="Rahul", upi_id="rahul@bank", balance=7500.0),
            AccountModel(id="usr_priya", name="Priya", upi_id="priya@bank", balance=12000.0),
            AccountModel(id="sanika@bank", name="Sanika", upi_id="sanika@bank", balance=10000.0),
            AccountModel(id="navya@bank", name="Navya", upi_id="navya@bank", balance=5000.0),
            AccountModel(id="rahul@bank", name="Rahul", upi_id="rahul@bank", balance=7500.0),
            AccountModel(id="priya@bank", name="Priya", upi_id="priya@bank", balance=12000.0),
            AccountModel(id="saba@bank", name="Saba", upi_id="saba@bank", balance=7500.0),
            AccountModel(id="manaswi@bank", name="Manaswi", upi_id="manaswi@bank", balance=12000.0),
            AccountModel(id="sai@bank", name="Sai", upi_id="sai@bank", balance=15000.0),
            AccountModel(id="sanika", name="Sanika", upi_id="sanika@bank", balance=10000.0),
            AccountModel(id="navya", name="Navya", upi_id="navya@bank", balance=5000.0),
            AccountModel(id="rahul", name="Rahul", upi_id="rahul@bank", balance=7500.0),
            AccountModel(id="priya", name="Priya", upi_id="priya@bank", balance=12000.0),
            AccountModel(id="saba", name="Saba", upi_id="saba@bank", balance=7500.0),
            AccountModel(id="manaswi", name="Manaswi", upi_id="manaswi@bank", balance=12000.0),
            AccountModel(id="sai", name="Sai", upi_id="sai@bank", balance=15000.0),
        ]
        for acc in default_accounts:
            existing = session.query(AccountModel).filter(AccountModel.id == acc.id).first()
            if not existing:
                session.add(acc)
        session.commit()
    finally:
        session.close()


def _find_account(session, account_id: str) -> AccountModel | None:
    if not account_id:
        return None
    account_id = account_id.strip()
    if "/" in account_id:
        parts = [p.strip() for p in account_id.split("/")]
        for p in reversed(parts):
            acc = _find_account(session, p)
            if acc:
                return acc

    acc = session.query(AccountModel).filter(AccountModel.id == account_id).first()
    if acc:
        return acc

    acc = session.query(AccountModel).filter(AccountModel.upi_id == account_id).first()
    if acc:
        return acc

    base_name = account_id.replace("usr_", "").split("@")[0]
    candidates = [
        f"usr_{base_name}",
        f"{base_name}@bank",
        base_name,
    ]
    for cand in candidates:
        acc = session.query(AccountModel).filter((AccountModel.id == cand) | (AccountModel.upi_id == cand) | (AccountModel.name == cand)).first()
        if acc:
            return acc
    return None


def get_account(account_id: str) -> dict | None:
    session = SessionLocal()
    try:
        acc = _find_account(session, account_id)
        if not acc:
            return None
        return {"name": acc.name, "balance": acc.balance}
    finally:
        session.close()


def list_accounts() -> dict[str, dict]:
    session = SessionLocal()
    try:
        accounts = session.query(AccountModel).all()
        return {acc.id: {"name": acc.name, "balance": acc.balance} for acc in accounts}
    finally:
        session.close()


def get_debit(transaction_id: str) -> dict | None:
    session = SessionLocal()
    try:
        debit = session.query(DebitModel).filter(DebitModel.transaction_id == transaction_id).first()
        if not debit:
            return None
        return {"senderId": debit.sender_id, "amount": debit.amount}
    finally:
        session.close()


def apply_debit(transaction_id: str, sender_id: str, amount: float) -> None:
    session = SessionLocal()
    try:
        acc = _find_account(session, sender_id)
        if acc:
            acc.balance -= amount
        debit = DebitModel(transaction_id=transaction_id, sender_id=sender_id, amount=amount)
        session.add(debit)
        session.commit()
    finally:
        session.close()


def rollback_debit(transaction_id: str) -> dict | None:
    session = SessionLocal()
    try:
        debit = session.query(DebitModel).filter(DebitModel.transaction_id == transaction_id).first()
        if not debit:
            return None

        acc = _find_account(session, debit.sender_id)
        if acc:
            acc.balance += debit.amount

        result = {"senderId": debit.sender_id, "amount": debit.amount}
        session.delete(debit)
        session.commit()
        return result
    finally:
        session.close()
