"""
Fetch CEM report CSV attachments from Gmail via IMAP.

Searches for emails from SMGMailMgr@WhySMG.com with subjects starting with
"smg reporting daily sales channel breakout by" and saves all CSV attachments
to the samples/ directory.

Prerequisites:
  1. Enable IMAP in Gmail: Settings > See all settings > Forwarding and POP/IMAP > Enable IMAP
  2. Generate an App Password: https://myaccount.google.com/apppasswords
     (requires 2-Step Verification to be enabled on your Google account)
  3. Copy .env.example to .env and fill in your email + app password

Usage:
  pip install -r requirements.txt
  python fetch_samples.py
"""

import imaplib
import email
from email.header import decode_header
import os
import re
import sys
from datetime import datetime
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

IMAP_SERVER = "imap.gmail.com"
IMAP_PORT = 993
SENDER = "SMGMailMgr@WhySMG.com"
SUBJECT_PREFIX = "smg reporting daily sales channel breakout by"
SAMPLES_DIR = Path(__file__).parent / "samples"


def sanitize_filename(name: str) -> str:
    """Remove characters unsafe for filenames."""
    name = re.sub(r'[<>:"/\\|?*]', '_', name)
    name = re.sub(r'\s+', '_', name)
    return name.strip('_')[:200]


def decode_mime_header(header_value: str) -> str:
    """Decode a MIME-encoded email header into a plain string."""
    if not header_value:
        return ""
    parts = decode_header(header_value)
    decoded = []
    for part, charset in parts:
        if isinstance(part, bytes):
            decoded.append(part.decode(charset or "utf-8", errors="replace"))
        else:
            decoded.append(part)
    return " ".join(decoded)


def connect_to_gmail(username: str, password: str) -> imaplib.IMAP4_SSL:
    """Authenticate and return an IMAP connection."""
    print(f"Connecting to {IMAP_SERVER}...")
    mail = imaplib.IMAP4_SSL(IMAP_SERVER, IMAP_PORT)
    mail.login(username, password)
    print("Authenticated successfully.")
    return mail


def search_emails(mail: imaplib.IMAP4_SSL) -> list[bytes]:
    """Search for matching emails and return message IDs."""
    mail.select("inbox")

    # Gmail IMAP supports X-GM-RAW for full Gmail search syntax
    query = f'X-GM-RAW "from:{SENDER} subject:\\"{SUBJECT_PREFIX}\\""'
    status, data = mail.search(None, query)

    if status != "OK" or not data[0]:
        # Fallback to standard IMAP search
        print("Gmail-specific search returned no results, trying standard IMAP search...")
        criteria = f'(FROM "{SENDER}" SUBJECT "{SUBJECT_PREFIX}")'
        status, data = mail.search(None, criteria)

    if status != "OK" or not data[0]:
        return []

    return data[0].split()


def extract_csv_attachments(mail: imaplib.IMAP4_SSL, msg_id: bytes) -> list[dict]:
    """Extract CSV attachments from a single email message."""
    status, msg_data = mail.fetch(msg_id, "(RFC822)")
    if status != "OK":
        return []

    msg = email.message_from_bytes(msg_data[0][1])
    subject = decode_mime_header(msg.get("Subject", ""))
    date_str = msg.get("Date", "")

    try:
        msg_date = email.utils.parsedate_to_datetime(date_str)
        date_prefix = msg_date.strftime("%Y-%m-%d")
    except Exception:
        date_prefix = "unknown_date"

    attachments = []
    for part in msg.walk():
        content_disposition = str(part.get("Content-Disposition", ""))
        if "attachment" not in content_disposition:
            continue

        filename = part.get_filename()
        if not filename:
            continue

        filename = decode_mime_header(filename)
        if not filename.lower().endswith(".csv"):
            continue

        payload = part.get_payload(decode=True)
        if not payload:
            continue

        attachments.append({
            "filename": filename,
            "subject": subject,
            "date": date_prefix,
            "data": payload,
        })

    return attachments


def save_attachments(attachments: list[dict], output_dir: Path) -> int:
    """Save attachment data to disk. Returns count of files saved."""
    output_dir.mkdir(parents=True, exist_ok=True)
    saved = 0

    for att in attachments:
        subject_slug = sanitize_filename(att["subject"])
        # Include date + subject context + original filename for traceability
        safe_name = f"{att['date']}_{subject_slug}_{sanitize_filename(att['filename'])}"
        if not safe_name.lower().endswith(".csv"):
            safe_name += ".csv"

        dest = output_dir / safe_name
        # Avoid overwriting
        counter = 1
        while dest.exists():
            stem = dest.stem
            dest = output_dir / f"{stem}_{counter}.csv"
            counter += 1

        dest.write_bytes(att["data"])
        print(f"  Saved: {dest.name}")
        saved += 1

    return saved


def main():
    username = os.getenv("GMAIL_ADDRESS")
    password = os.getenv("GMAIL_APP_PASSWORD")

    if not username or not password:
        print("Error: GMAIL_ADDRESS and GMAIL_APP_PASSWORD must be set.")
        print("Copy .env.example to .env and fill in your credentials.")
        sys.exit(1)

    mail = connect_to_gmail(username, password)

    try:
        msg_ids = search_emails(mail)
        print(f"Found {len(msg_ids)} matching email(s).")

        if not msg_ids:
            print("No emails matched. Check that:")
            print(f"  - Sender: {SENDER}")
            print(f"  - Subject starts with: \"{SUBJECT_PREFIX}\"")
            print("  - IMAP is enabled in Gmail settings")
            return

        all_attachments = []
        for i, msg_id in enumerate(msg_ids, 1):
            print(f"\nProcessing email {i}/{len(msg_ids)}...")
            attachments = extract_csv_attachments(mail, msg_id)
            if attachments:
                print(f"  Found {len(attachments)} CSV attachment(s): "
                      f"subject=\"{attachments[0]['subject'][:80]}...\"")
            else:
                status, msg_data = mail.fetch(msg_id, "(BODY[HEADER.FIELDS (SUBJECT)])")
                raw_subject = msg_data[0][1].decode(errors="replace") if msg_data[0][1] else "?"
                print(f"  No CSV attachments found. Subject: {raw_subject.strip()}")
            all_attachments.extend(attachments)

        if all_attachments:
            saved = save_attachments(all_attachments, SAMPLES_DIR)
            print(f"\nDone! {saved} CSV file(s) saved to {SAMPLES_DIR.resolve()}")
        else:
            print("\nNo CSV attachments found in any matching emails.")

    finally:
        mail.logout()


if __name__ == "__main__":
    main()
