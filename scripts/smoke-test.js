const fs = require("fs/promises");
const path = require("path");
const { server, ensureDb } = require("../server");

const DB_FILE = path.join(__dirname, "..", "data", "db.json");

async function request(baseUrl, route, options = {}) {
  const response = await fetch(`${baseUrl}${route}`, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(`${options.method || "GET"} ${route} failed: ${data.error || response.statusText}`);
  }
  return { data, headers: response.headers };
}

async function cleanup(email) {
  const db = JSON.parse(await fs.readFile(DB_FILE, "utf8"));
  const user = db.users.find((item) => item.email === email);
  if (!user) return;

  const postIds = new Set(db.posts.filter((post) => post.authorId === user.id).map((post) => post.id));
  db.comments = db.comments.filter((comment) => comment.authorId !== user.id && !postIds.has(comment.postId));
  db.posts = db.posts.filter((post) => post.authorId !== user.id);
  db.sessions = db.sessions.filter((session) => session.userId !== user.id);
  db.users = db.users.filter((item) => item.id !== user.id);
  await fs.writeFile(DB_FILE, JSON.stringify(db, null, 2));
}

async function main() {
  await ensureDb();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;
  const email = `codex-${Date.now()}@example.com`;
  let cookie = "";

  try {
    await request(baseUrl, "/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ name: "Codex Tester", email, password: "password123" })
    });

    const login = await request(baseUrl, "/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password: "password123" })
    });
    cookie = login.headers.get("set-cookie").split(";")[0];

    const post = await request(baseUrl, "/api/posts", {
      method: "POST",
      headers: { Cookie: cookie },
      body: JSON.stringify({
        title: "Smoke Test Post",
        excerpt: "API smoke test",
        content: "Created during verification."
      })
    });

    const postId = post.data.post.id;
    const comment = await request(baseUrl, `/api/posts/${postId}/comments`, {
      method: "POST",
      headers: { Cookie: cookie },
      body: JSON.stringify({ content: "Comment smoke test." })
    });

    await request(baseUrl, `/api/posts/${postId}`, {
      method: "PUT",
      headers: { Cookie: cookie },
      body: JSON.stringify({
        title: "Smoke Test Post Edited",
        excerpt: "Edited",
        content: "Updated during verification."
      })
    });

    await request(baseUrl, `/api/comments/${comment.data.comment.id}`, {
      method: "DELETE",
      headers: { Cookie: cookie }
    });
    await request(baseUrl, `/api/posts/${postId}`, {
      method: "DELETE",
      headers: { Cookie: cookie }
    });
    await request(baseUrl, "/api/auth/logout", {
      method: "POST",
      headers: { Cookie: cookie }
    });

    console.log("Smoke test passed: auth, posts, comments, edit, delete, and logout all work.");
  } finally {
    server.close();
    await cleanup(email);
  }
}

main().catch((error) => {
  server.close();
  console.error(error.message);
  process.exitCode = 1;
});
