import httpx
from typing import Optional


class MetaWhatsAppError(RuntimeError):
    """Error safe to persist in operational logs without leaking credentials."""


class MetaWhatsApp:
    def __init__(
        self,
        graph_version: str,
        phone_number_id: str,
        token: str,
        transport: Optional[httpx.AsyncBaseTransport] = None,
    ):
        self.base = f"https://graph.facebook.com/{graph_version}/{phone_number_id}/messages"
        self.headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
        self.client = httpx.AsyncClient(timeout=10, transport=transport)

    async def _request(self, payload: dict) -> dict:
        response = await self.client.post(self.base, headers=self.headers, json=payload)
        try:
            data = response.json()
        except ValueError:
            data = {}
        if response.is_error:
            error = data.get("error", {}) if isinstance(data, dict) else {}
            code = error.get("code", "unknown")
            subcode = error.get("error_subcode")
            message = str(error.get("message") or response.reason_phrase or "Meta request failed")
            suffix = f"/{subcode}" if subcode is not None else ""
            raise MetaWhatsAppError(f"Meta HTTP {response.status_code} code {code}{suffix}: {message}")
        return data

    @staticmethod
    def _message_id(data: dict) -> str:
        try:
            return str(data["messages"][0]["id"])
        except (KeyError, IndexError, TypeError) as exc:
            raise MetaWhatsAppError("Meta response did not contain a message id") from exc

    async def send_text(self, phone: str, text: str) -> str:
        data = await self._request({
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": phone,
            "type": "text",
            "text": {"preview_url": True, "body": text},
        })
        return self._message_id(data)

    async def send_audio(self, phone: str, media_id: str) -> str:
        data = await self._request({
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": phone,
            "type": "audio",
            "audio": {"id": media_id},
        })
        return self._message_id(data)

    async def mark_read(self, message_id: str) -> None:
        await self._request({"messaging_product": "whatsapp", "status": "read", "message_id": message_id})

    async def close(self) -> None:
        await self.client.aclose()
