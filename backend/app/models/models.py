from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey
from sqlalchemy.sql import func
from app.db.database import Base

class Media(Base):
    __tablename__ = "media"
    id = Column(Integer, primary_key=True)
    original_name = Column(String(255), nullable=False)
    file_path = Column(String(500), nullable=False)
    media_type = Column(String(50), nullable=False)
    status = Column(String(50), default="uploaded")
    language = Column(String(20), nullable=True)
    transcript = Column(Text, default="")
    created_at = Column(DateTime, server_default=func.now())

class Note(Base):
    __tablename__ = "notes"
    id = Column(Integer, primary_key=True)
    media_id = Column(Integer, ForeignKey("media.id"), nullable=True)
    note_type = Column(String(30), nullable=False)
    title = Column(String(255), nullable=True)
    content_json = Column(Text, nullable=False)
    note_language = Column(String(20), default="en")
    note_labels_json = Column(Text, default="{}")
    created_at = Column(DateTime, server_default=func.now())

class Task(Base):
    __tablename__ = "tasks"
    id = Column(Integer, primary_key=True)
    media_id = Column(Integer, ForeignKey("media.id"), nullable=True)
    title = Column(String(255), nullable=False)
    description = Column(Text, default="")
    assigned_to = Column(String(255), default="")
    deadline = Column(String(100), default="")
    priority = Column(String(50), default="Medium")
    status = Column(String(50), default="Pending")
    created_at = Column(DateTime, server_default=func.now())

class ChatMessage(Base):
    __tablename__ = "chat_messages"
    id = Column(Integer, primary_key=True)
    note_id = Column(Integer, ForeignKey("notes.id"), nullable=True)
    role = Column(String(20), nullable=False)
    content = Column(Text, nullable=False)
    created_at = Column(DateTime, server_default=func.now())

class Reminder(Base):
    __tablename__ = "reminders"
    id = Column(Integer, primary_key=True)
    task_id = Column(Integer, ForeignKey("tasks.id"), nullable=True)
    title = Column(String(255), nullable=False)
    remind_at = Column(String(100), nullable=False)
    status = Column(String(30), default="scheduled")
    calendar_event_id = Column(String(255), default="")
