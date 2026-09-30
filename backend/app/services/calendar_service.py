import os
from google_auth_oauthlib.flow import Flow
from googleapiclient.discovery import build
from google.oauth2.credentials import Credentials
from app.config import settings

SCOPES=["https://www.googleapis.com/auth/calendar.events"]
TOKEN_FILE="storage/google_token.json"

def authorization_url():
    if not os.path.exists(settings.google_client_secret_file):
        raise FileNotFoundError("credentials.json not found. Add Google OAuth desktop/web credentials to backend/credentials.json")
    flow=Flow.from_client_secrets_file(settings.google_client_secret_file, scopes=SCOPES, redirect_uri=settings.google_redirect_uri)
    url,state=flow.authorization_url(access_type="offline", include_granted_scopes="true", prompt="consent")
    return url,state

def callback(code):
    flow=Flow.from_client_secrets_file(settings.google_client_secret_file, scopes=SCOPES, redirect_uri=settings.google_redirect_uri)
    flow.fetch_token(code=code)
    creds=flow.credentials
    with open(TOKEN_FILE,"w") as f:f.write(creds.to_json())
    return True

def create_event(summary, start_iso, description=""):
    if not os.path.exists(TOKEN_FILE): raise RuntimeError("Google Calendar is not connected. Open /api/calendar/auth first.")
    creds=Credentials.from_authorized_user_file(TOKEN_FILE,SCOPES)
    service=build("calendar","v3",credentials=creds)
    body={"summary":summary,"description":description,"start":{"dateTime":start_iso,"timeZone":"Asia/Kolkata"},"end":{"dateTime":start_iso,"timeZone":"Asia/Kolkata"}}
    return service.events().insert(calendarId="primary",body=body).execute()
