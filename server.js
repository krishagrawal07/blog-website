const http = require("http");
const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = path.join(ROOT, "data");
const DB_FILE = path.join(DATA_DIR, "db.json");
const TOKEN_TTL_MS = 1000 * 60 * 60 * 24 * 7;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon"
};

async function ensureDb() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(DB_FILE);
  } catch {
    const now = new Date().toISOString();
    const demoPassword = hashPassword("password123");
    const db = {
      users: [
        {
          id: crypto.randomUUID(),
          name: "Demo Author",
          email: "demo@example.com",
          passwordHash: demoPassword.hash,
          salt: demoPassword.salt,
          createdAt: now
        }
      ],
      sessions: [],
      posts: [],
      comments: []
    };
    db.posts.push({
      id: crypto.randomUUID(),
      title: "Welcome to Inkline",
      excerpt: "A calm, complete blogging workspace for drafting ideas and talking with readers.",
      content:
        "This sample post is here so the app has a little life when it first opens. Register a new account, create your own post, edit it, delete it, and leave comments on posts from other authors.",
      authorId: db.users[0].id,
      createdAt: now,
      updatedAt: now
    });
    await writeDb(db);
  }
}

async function readDb() {
  await ensureDb();
  return JSON.parse(await fs.readFile(DB_FILE, "utf8"));
}

async function writeDb(db) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(DB_FILE, JSON.stringify(db, null, 2));
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, "sha512").toString("hex");
  return { salt, hash };
}

function verifyPassword(password, user) {
  return hashPassword(password, user.salt).hash === user.passwordHash;
}

function publicUser(user) {
  if (!user) {
    return {
      id: "unknown",
      name: "Unknown user",
      email: "",
      createdAt: ""
    };
  }

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    createdAt: user.createdAt
  };
}

function attachCommentMeta(db, comment) {
  return {
    ...comment,
    author: publicUser(db.users.find((user) => user.id === comment.authorId))
  };
}

function attachPostMeta(db, post) {
  const author = db.users.find((user) => user.id === post.authorId);
  const comments = db.comments
    .filter((comment) => comment.postId === post.id)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    .map((comment) => attachCommentMeta(db, comment));

  return {
    ...post,
    author: publicUser(author),
    comments,
    commentCount: comments.length
  };
}

function parseCookies(cookieHeader = "") {
  return Object.fromEntries(
    cookieHeader
      .split(";")
      .map((cookie) => cookie.trim())
      .filter(Boolean)
      .map((cookie) => {
        const index = cookie.indexOf("=");
        return [cookie.slice(0, index), decodeURIComponent(cookie.slice(index + 1))];
      })
  );
}

async function getAuth(req, db) {
  const bearer = req.headers.authorization?.startsWith("Bearer ")
    ? req.headers.authorization.slice(7)
    : "";
  const token = bearer || parseCookies(req.headers.cookie).token;
  if (!token) return null;

  const session = db.sessions.find((item) => item.token === token);
  if (!session || new Date(session.expiresAt) <= new Date()) return null;

  const user = db.users.find((item) => item.id === session.userId);
  return user ? { user, token } : null;
}

function sendJson(res, statusCode, payload, headers = {}) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    ...headers
  });
  res.end(JSON.stringify(payload));
}

function sendError(res, statusCode, message, details = {}) {
  sendJson(res, statusCode, { error: message, ...details });
}

async function readBody(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 1_000_000) throw new Error("Request body is too large.");
  }
  return body ? JSON.parse(body) : {};
}

function requireFields(data, fields) {
  return fields.filter((field) => typeof data[field] !== "string" || !data[field].trim());
}

function slugText(value) {
  return value.trim().replace(/\s+/g, " ");
}

async function handleApi(req, res, url) {
  const db = await readDb();
  const auth = await getAuth(req, db);
  const route = url.pathname;
  const method = req.method;

  if (method === "GET" && route === "/api/health") {
    return sendJson(res, 200, { ok: true });
  }

  if (method === "POST" && route === "/api/auth/register") {
    const body = await readBody(req);
    const missing = requireFields(body, ["name", "email", "password"]);
    if (missing.length) return sendError(res, 400, "Missing required fields.", { fields: missing });

    const email = body.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return sendError(res, 400, "Enter a valid email address.");
    if (body.password.length < 8) return sendError(res, 400, "Password must be at least 8 characters.");
    if (db.users.some((user) => user.email === email)) return sendError(res, 409, "That email is already registered.");

    const password = hashPassword(body.password);
    const user = {
      id: crypto.randomUUID(),
      name: slugText(body.name).slice(0, 80),
      email,
      passwordHash: password.hash,
      salt: password.salt,
      createdAt: new Date().toISOString()
    };
    db.users.push(user);
    await writeDb(db);
    return sendJson(res, 201, { user: publicUser(user) });
  }

  if (method === "POST" && route === "/api/auth/login") {
    const body = await readBody(req);
    const missing = requireFields(body, ["email", "password"]);
    if (missing.length) return sendError(res, 400, "Email and password are required.");

    const user = db.users.find((item) => item.email === body.email.trim().toLowerCase());
    if (!user || !verifyPassword(body.password, user)) return sendError(res, 401, "Invalid email or password.");

    const token = crypto.randomBytes(32).toString("hex");
    db.sessions.push({
      token,
      userId: user.id,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + TOKEN_TTL_MS).toISOString()
    });
    await writeDb(db);
    return sendJson(res, 200, { token, user: publicUser(user) }, {
      "Set-Cookie": `token=${encodeURIComponent(token)}; HttpOnly; Path=/; Max-Age=${TOKEN_TTL_MS / 1000}; SameSite=Lax`
    });
  }

  if (method === "POST" && route === "/api/auth/logout") {
    if (auth) {
      db.sessions = db.sessions.filter((session) => session.token !== auth.token);
      await writeDb(db);
    }
    return sendJson(res, 200, { ok: true }, {
      "Set-Cookie": "token=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax"
    });
  }

  if (method === "GET" && route === "/api/auth/me") {
    return sendJson(res, 200, { user: auth ? publicUser(auth.user) : null });
  }

  if (method === "GET" && route === "/api/posts") {
    const posts = db.posts
      .slice()
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
      .map((post) => attachPostMeta(db, post));
    return sendJson(res, 200, { posts });
  }

  const postIdMatch = route.match(/^\/api\/posts\/([^/]+)$/);
  if (method === "GET" && postIdMatch) {
    const post = db.posts.find((item) => item.id === postIdMatch[1]);
    if (!post) return sendError(res, 404, "Post not found.");
    return sendJson(res, 200, { post: attachPostMeta(db, post) });
  }

  if (method === "POST" && route === "/api/posts") {
    if (!auth) return sendError(res, 401, "You need to log in first.");
    const body = await readBody(req);
    const missing = requireFields(body, ["title", "content"]);
    if (missing.length) return sendError(res, 400, "Title and content are required.");

    const content = body.content.trim();
    const post = {
      id: crypto.randomUUID(),
      title: slugText(body.title).slice(0, 140),
      excerpt: (body.excerpt?.trim() || content.slice(0, 160)).slice(0, 220),
      content,
      authorId: auth.user.id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    db.posts.push(post);
    await writeDb(db);
    return sendJson(res, 201, { post: attachPostMeta(db, post) });
  }

  if ((method === "PUT" || method === "DELETE") && postIdMatch) {
    if (!auth) return sendError(res, 401, "You need to log in first.");
    const post = db.posts.find((item) => item.id === postIdMatch[1]);
    if (!post) return sendError(res, 404, "Post not found.");
    if (post.authorId !== auth.user.id) return sendError(res, 403, "Only the author can change this post.");

    if (method === "DELETE") {
      db.posts = db.posts.filter((item) => item.id !== post.id);
      db.comments = db.comments.filter((comment) => comment.postId !== post.id);
      await writeDb(db);
      return sendJson(res, 200, { ok: true });
    }

    const body = await readBody(req);
    const missing = requireFields(body, ["title", "content"]);
    if (missing.length) return sendError(res, 400, "Title and content are required.");
    post.title = slugText(body.title).slice(0, 140);
    post.content = body.content.trim();
    post.excerpt = (body.excerpt?.trim() || post.content.slice(0, 160)).slice(0, 220);
    post.updatedAt = new Date().toISOString();
    await writeDb(db);
    return sendJson(res, 200, { post: attachPostMeta(db, post) });
  }

  const commentRoute = route.match(/^\/api\/posts\/([^/]+)\/comments$/);
  if (method === "POST" && commentRoute) {
    if (!auth) return sendError(res, 401, "You need to log in first.");
    const post = db.posts.find((item) => item.id === commentRoute[1]);
    if (!post) return sendError(res, 404, "Post not found.");

    const body = await readBody(req);
    const missing = requireFields(body, ["content"]);
    if (missing.length) return sendError(res, 400, "Comment content is required.");

    const comment = {
      id: crypto.randomUUID(),
      postId: post.id,
      authorId: auth.user.id,
      content: body.content.trim().slice(0, 1000),
      createdAt: new Date().toISOString()
    };
    db.comments.push(comment);
    await writeDb(db);
    return sendJson(res, 201, { comment: attachCommentMeta(db, comment) });
  }

  const commentIdRoute = route.match(/^\/api\/comments\/([^/]+)$/);
  if (method === "DELETE" && commentIdRoute) {
    if (!auth) return sendError(res, 401, "You need to log in first.");
    const comment = db.comments.find((item) => item.id === commentIdRoute[1]);
    if (!comment) return sendError(res, 404, "Comment not found.");
    if (comment.authorId !== auth.user.id) return sendError(res, 403, "Only the comment author can delete it.");
    db.comments = db.comments.filter((item) => item.id !== comment.id);
    await writeDb(db);
    return sendJson(res, 200, { ok: true });
  }

  sendError(res, 404, "API route not found.");
}

async function serveStatic(req, res, url) {
  const requested = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const resolved = path.normalize(path.join(PUBLIC_DIR, requested));
  const insidePublic = resolved === PUBLIC_DIR || resolved.startsWith(`${PUBLIC_DIR}${path.sep}`);
  if (!insidePublic) {
    res.writeHead(403);
    return res.end("Forbidden");
  }

  try {
    const file = await fs.readFile(resolved);
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[path.extname(resolved)] || "application/octet-stream"
    });
    res.end(file);
  } catch {
    const fallback = await fs.readFile(path.join(PUBLIC_DIR, "index.html"));
    res.writeHead(200, { "Content-Type": MIME_TYPES[".html"] });
    res.end(fallback);
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
    } else {
      await serveStatic(req, res, url);
    }
  } catch (error) {
    const status = error instanceof SyntaxError ? 400 : 500;
    sendError(res, status, status === 400 ? "Invalid JSON body." : "Something went wrong.");
    console.error(error);
  }
});

async function startServer(port = PORT) {
  await ensureDb();
  server.listen(port, () => {
    console.log(`Blog platform running at http://localhost:${port}`);
  });
}

if (require.main === module) {
  startServer();
}

module.exports = { server, startServer, ensureDb };
