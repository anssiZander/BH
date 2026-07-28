const worker = {
  async fetch(request, env) {
    const response = await env.ASSETS.fetch(request);
    const contentType = response.headers.get("content-type") || "";

    if (!contentType.includes("text/html")) {
      return response;
    }

    const origin = new URL(request.url).origin;
    const html = (await response.text()).replaceAll(
      'content="/assets/social-preview.png"',
      `content="${origin}/assets/social-preview.png"`,
    );
    const headers = new Headers(response.headers);
    headers.set("content-type", "text/html; charset=utf-8");

    return new Response(html, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  },
};

export default worker;
