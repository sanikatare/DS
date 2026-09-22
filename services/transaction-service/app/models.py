"""
SQLAlchemy ORM models for Transaction Service database.
Database File: upi_simulator.db
"""
from datetime import datetime, timezone
from sqlalchemy import Column, Integer, String, Float, ForeignKey, Text
from sqlalchemy.orm import declarative_base, relationship

Base = declarative_base()


class UserModel(Base):
    __tablename__ = "users"

    id = Column(String(50), primary_key=True)
    name = Column(String(100), nullable=False)
    upi_id = Column(String(100), nullable=True)
    bank_name = Column(String(100), nullable=True)
    balance = Column(Float, nullable=False, default=0.0)
    created_at = Column(String(50), nullable=True, default=lambda: datetime.now(timezone.utc).isoformat())


class TransactionModel(Base):
    __tablename__ = "transactions"

    transaction_id = Column(String(50), primary_key=True)
    sender_upi = Column(String(100), nullable=True)
    receiver_upi = Column(String(100), nullable=True)
    sender_id = Column(String(100), nullable=True)
    receiver_id = Column(String(100), nullable=True)
    amount = Column(Float, nullable=False)
    status = Column(String(50), nullable=False, default="INITIATED")
    failure_reason = Column(Text, nullable=True)
    idempotency_key = Column(String(100), unique=True, nullable=True, index=True)
    created_at = Column(String(50), nullable=False)
    updated_at = Column(String(50), nullable=False)

    events = relationship("TransactionEventModel", back_populates="transaction", cascade="all, delete-orphan")


class TransactionEventModel(Base):
    __tablename__ = "transaction_events"

    id = Column(Integer, primary_key=True, autoincrement=True)
    transaction_id = Column(String(50), ForeignKey("transactions.transaction_id"), nullable=False, index=True)
    event_type = Column(String(100), nullable=True)
    event = Column(String(100), nullable=True)
    service_name = Column(String(100), nullable=True)
    message = Column(Text, nullable=True)
    timestamp = Column(String(50), nullable=False)

    transaction = relationship("TransactionModel", back_populates="events")
