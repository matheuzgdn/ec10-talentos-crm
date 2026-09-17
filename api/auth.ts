import {
  createCrmSession,
  createCrmUser,
  destroyCrmSession,
  handleApiError,
  loginCrmUser
} from "./_auth.js";
import meHandler from "./_me.js";

export default async function handler(request: any, response: any) {
  if (request.method === "GET" && request.query?.mode === "me") return meHandler(request, response);
  if (request.method !== "POST") {
    response.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const { action, email, password } = request.body ?? {};

    if (action === "logout") {
      await destroyCrmSession(request, response);
      response.status(200).json({ ok: true });
      return;
    }

    if (action === "signup") {
      const result = await createCrmUser(String(email ?? ""), String(password ?? ""));
      await createCrmSession(response, result.user.id);
      response.status(200).json({ seller: result.seller });
      return;
    }

    if (action === "login") {
      const result = await loginCrmUser(String(email ?? ""), String(password ?? ""));
      await createCrmSession(response, result.user.id);
      response.status(200).json({ seller: result.seller });
      return;
    }

    response.status(400).json({ error: "Invalid auth action" });
  } catch (error) {
    handleApiError(response, error);
  }
}
