"""Load demo data:  python -m scripts.seed   (run from backend/, after `alembic upgrade head`)

Creates users alice, bob, carol, dave (password: password123), contacts, chats, a group and statuses.
"""
from datetime import timedelta

from sqlalchemy import select

from app.config import get_settings
from app.database import SessionLocal, utcnow
from app.models import Chat, Contact, Member, Status, User
from app.security import hash_password
from app.services import messaging

PEOPLE = [("alice", "Alice Johnson", "Coffee first, then code."), ("bob", "Bob Smith", "At the gym"),
          ("carol", "Carol Diaz", "Busy"), ("dave", "Dave Lee", "Available")]


def main():
    with SessionLocal() as db:
        if db.scalar(select(User).where(User.username == "alice")):
            print("Seed data already present - nothing to do.")
            return
        users = {}
        for username, name, about in PEOPLE:
            u = User(username=username, email=f"{username}@example.com", display_name=name, about=about,
                     password_hash=hash_password("password123"))
            db.add(u)
            users[username] = u
        db.flush()
        for a in users.values():
            for b in users.values():
                if a.id != b.id:
                    db.add(Contact(owner_id=a.id, contact_id=b.id))
        db.commit()

        def direct(a, b):
            c = Chat(type="direct", direct_key=f"{min(a.id, b.id)}:{max(a.id, b.id)}", created_by=a.id)
            db.add(c)
            db.flush()
            db.add_all([Member(chat_id=c.id, user_id=a.id), Member(chat_id=c.id, user_id=b.id)])
            db.commit()
            return c

        a, b, c, d = (users[n] for n in ("alice", "bob", "carol", "dave"))
        ab = direct(a, b)
        for sender, text in [(a, "Hey Bob! 👋"), (b, "Hi Alice, how's the project?"), (a, "Going great - demo on Friday."),
                             (b, "Awesome, count me in 🎉")]:
            messaging.publish_new_message(db, messaging.create_message(db, sender, ab, body=text))
        ac = direct(a, c)
        messaging.publish_new_message(db, messaging.create_message(db, c, ac, body="Lunch at 1?"))

        g = Chat(type="group", name="Project Team", description="Launch planning", created_by=a.id)
        db.add(g)
        db.flush()
        db.add(Member(chat_id=g.id, user_id=a.id, role="admin"))
        db.add_all([Member(chat_id=g.id, user_id=u.id) for u in (b, c, d)])
        db.commit()
        messaging.system_message(db, g, "Alice Johnson created group \"Project Team\"")
        messaging.publish_new_message(db, messaging.create_message(db, d, g, body="Welcome everyone!"))

        now = utcnow()
        ttl = timedelta(hours=get_settings().status_ttl_hours)
        db.add(Status(user_id=b.id, type="text", body="Shipping day! 🚀", bg_color="#6D28D9", created_at=now, expires_at=now + ttl))
        db.add(Status(user_id=c.id, type="text", body="Sunny weekend ☀️", bg_color="#0E7490", created_at=now, expires_at=now + ttl))
        db.commit()
        print("Seeded. Log in as alice / bob / carol / dave with password 'password123'.")


if __name__ == "__main__":
    main()
