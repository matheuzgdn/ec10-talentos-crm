import { ensureSeller, handleApiError } from "./_auth.js";

export default async function handler(request: any, response: any) {
  if (request.method !== "GET") {
    response.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const { seller } = await ensureSeller(request);
    response.setHeader("cache-control", "no-store");
    response.status(200).json({ seller });
  } catch (error) {
    handleApiError(response, error);
  }
}
