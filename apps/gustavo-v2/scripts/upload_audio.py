import mimetypes
from pathlib import Path
import httpx
from app.config import get_settings


def upload(path: Path):
    settings = get_settings()
    url = f"https://graph.facebook.com/{settings.meta_graph_version}/{settings.meta_phone_number_id}/media"
    headers = {"Authorization": f"Bearer {settings.meta_whatsapp_access_token}"}
    mime = mimetypes.guess_type(path.name)[0] or "audio/ogg"
    with path.open("rb") as source:
        response = httpx.post(url, headers=headers, data={"messaging_product": "whatsapp", "type": mime}, files={"file": (path.name, source, mime)}, timeout=60)
    response.raise_for_status()
    print(path.name, response.json()["id"])


if __name__ == "__main__":
    import sys
    for value in sys.argv[1:]:
        upload(Path(value))
