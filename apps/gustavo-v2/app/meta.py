import httpx


class MetaWhatsApp:
    def __init__(self, graph_version: str, phone_number_id: str, token: str):
        self.base = f"https://graph.facebook.com/{graph_version}/{phone_number_id}/messages"
        self.headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    async def _send(self, payload: dict) -> str:
        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.post(self.base, headers=self.headers, json=payload)
            response.raise_for_status()
            data = response.json()
            return str(data["messages"][0]["id"])

    async def send_text(self, phone: str, text: str) -> str:
        return await self._send({
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": phone,
            "type": "text",
            "text": {"preview_url": True, "body": text},
        })

    async def send_audio(self, phone: str, media_id: str) -> str:
        return await self._send({
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": phone,
            "type": "audio",
            "audio": {"id": media_id},
        })

    async def mark_read(self, message_id: str) -> None:
        await self._send({"messaging_product": "whatsapp", "status": "read", "message_id": message_id})
