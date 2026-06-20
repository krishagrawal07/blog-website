const state = {
  user: null,
  posts: [],
  authMode: "login",
  search: ""
};

const elements = {
  authButton: document.querySelector("#authButton"),
  authDialog: document.querySelector("#authDialog"),
  authForm: document.querySelector("#authForm"),
  authSubmit: document.querySelector("#authSubmit"),
  loginTab: document.querySelector("#loginTab"),
  registerTab: document.querySelector("#registerTab"),
  nameField: document.querySelector("#nameField"),
  nameInput: document.querySelector("#nameInput"),
  emailInput: document.querySelector("#emailInput"),
  passwordInput: document.querySelector("#passwordInput"),
  userBadge: document.querySelector("#userBadge"),
  newPostButton: document.querySelector("#newPostButton"),
  composer: document.querySelector("#composer"),
  closeComposer: document.querySelector("#closeComposer"),
  postForm: document.querySelector("#postForm"),
  postId: document.querySelector("#postId"),
  postTitle: document.querySelector("#postTitle"),
  postExcerpt: document.querySelector("#postExcerpt"),
  postContent: document.querySelector("#postContent"),
  resetPostForm: document.querySelector("#resetPostForm"),
  composerTitle: document.querySelector("#composerTitle"),
  posts: document.querySelector("#posts"),
  postCount: document.querySelector("#postCount"),
  commentCount: document.querySelector("#commentCount"),
  searchInput: document.querySelector("#searchInput"),
  toast: document.querySelector("#toast")
};

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data;
}

function toast(message) {
  elements.toast.textContent = message;
  elements.toast.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => {
    elements.toast.hidden = true;
  }, 2800);
}

function formatDate(value) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(new Date(value));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function setAuthMode(mode) {
  state.authMode = mode;
  const isRegister = mode === "register";
  elements.loginTab.classList.toggle("active", !isRegister);
  elements.registerTab.classList.toggle("active", isRegister);
  elements.nameField.hidden = !isRegister;
  elements.nameInput.required = isRegister;
  elements.passwordInput.autocomplete = isRegister ? "new-password" : "current-password";
  elements.authSubmit.textContent = isRegister ? "Create account" : "Log in";
}

function syncAuthUi() {
  const loggedIn = Boolean(state.user);
  elements.userBadge.hidden = !loggedIn;
  elements.newPostButton.hidden = !loggedIn;
  elements.authButton.textContent = loggedIn ? "Log out" : "Log in";
  if (loggedIn) elements.userBadge.textContent = state.user.name;
}

function resetComposer() {
  elements.postId.value = "";
  elements.postTitle.value = "";
  elements.postExcerpt.value = "";
  elements.postContent.value = "";
  elements.composerTitle.textContent = "Create post";
}

function openComposer(post = null) {
  elements.composer.hidden = false;
  if (post) {
    elements.postId.value = post.id;
    elements.postTitle.value = post.title;
    elements.postExcerpt.value = post.excerpt || "";
    elements.postContent.value = post.content;
    elements.composerTitle.textContent = "Edit post";
  } else {
    resetComposer();
  }
  elements.postTitle.focus();
}

function visiblePosts() {
  const term = state.search.trim().toLowerCase();
  if (!term) return state.posts;
  return state.posts.filter((post) =>
    [post.title, post.excerpt, post.content, post.author.name].some((part) =>
      part.toLowerCase().includes(term)
    )
  );
}

function renderStats() {
  elements.postCount.textContent = state.posts.length;
  elements.commentCount.textContent = state.posts.reduce((sum, post) => sum + post.commentCount, 0);
}

function renderPosts() {
  renderStats();
  const posts = visiblePosts();
  if (!posts.length) {
    elements.posts.innerHTML = `<div class="empty">No posts found. ${state.user ? "Create the first one." : "Log in to start writing."}</div>`;
    return;
  }

  elements.posts.innerHTML = posts
    .map((post, index) => {
      const canEdit = state.user?.id === post.author.id;
      const initials = post.author.name
        .split(" ")
        .map((part) => part[0])
        .join("")
        .slice(0, 2)
        .toUpperCase();
      const comments = post.comments
        .map(
          (comment) => `
            <div class="comment">
              <div class="comment-row">
                <strong>${escapeHtml(comment.author.name)}</strong>
                ${
                  state.user?.id === comment.author.id
                    ? `<button class="button secondary" data-delete-comment="${comment.id}" type="button">Delete</button>`
                    : ""
                }
              </div>
              <p>${escapeHtml(comment.content)}</p>
            </div>
          `
        )
        .join("");

      return `
        <article class="post-card" data-post-id="${post.id}">
          <div class="post-number">${String(index + 1).padStart(2, "0")}</div>
          <div class="post-title-row">
            <div>
              <p class="post-kicker">Editor’s journal</p>
              <h3>${escapeHtml(post.title)}</h3>
              <div class="meta">
                <span class="author-avatar">${escapeHtml(initials)}</span>
                <span>By <strong>${escapeHtml(post.author.name)}</strong></span>
                <span>${formatDate(post.updatedAt)}</span>
                <span>${post.commentCount} comments</span>
              </div>
            </div>
            ${
              canEdit
                ? `<div class="post-actions">
                    <button class="button secondary" data-edit-post="${post.id}" type="button">Edit</button>
                    <button class="button danger" data-delete-post="${post.id}" type="button">Delete</button>
                  </div>`
                : ""
            }
          </div>
          ${post.excerpt ? `<p class="post-excerpt">${escapeHtml(post.excerpt)}</p>` : ""}
          <p class="post-body">${escapeHtml(post.content)}</p>
          <section class="comments">
            <h4>Comments</h4>
            <div class="comment-list">${comments || `<p class="hint">No comments yet.</p>`}</div>
            ${
              state.user
                ? `<form class="comment-form" data-comment-form="${post.id}">
                    <textarea name="content" rows="2" placeholder="Add a comment" required></textarea>
                    <button class="button primary" type="submit">Comment</button>
                  </form>`
                : `<p class="hint">Log in to comment.</p>`
            }
          </section>
        </article>
      `;
    })
    .join("");
}

async function loadPosts() {
  const data = await api("/api/posts");
  state.posts = data.posts;
  renderPosts();
}

async function loadMe() {
  const data = await api("/api/auth/me");
  state.user = data.user;
  syncAuthUi();
}

async function boot() {
  await loadMe();
  await loadPosts();
}

elements.authButton.addEventListener("click", async () => {
  if (state.user) {
    await api("/api/auth/logout", { method: "POST" });
    state.user = null;
    syncAuthUi();
    elements.composer.hidden = true;
    renderPosts();
    toast("Logged out.");
    return;
  }
  setAuthMode("login");
  elements.authDialog.showModal();
});

elements.loginTab.addEventListener("click", () => setAuthMode("login"));
elements.registerTab.addEventListener("click", () => setAuthMode("register"));

elements.authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const payload = {
    email: elements.emailInput.value,
    password: elements.passwordInput.value
  };
  if (state.authMode === "register") payload.name = elements.nameInput.value;

  try {
    const route = state.authMode === "register" ? "/api/auth/register" : "/api/auth/login";
    await api(route, { method: "POST", body: JSON.stringify(payload) });
    if (state.authMode === "register") {
      await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: payload.email, password: payload.password })
      });
    }
    elements.authDialog.close();
    elements.authForm.reset();
    await loadMe();
    await loadPosts();
    toast(state.authMode === "register" ? "Account created." : "Welcome back.");
  } catch (error) {
    toast(error.message);
  }
});

elements.newPostButton.addEventListener("click", () => openComposer());
elements.closeComposer.addEventListener("click", () => {
  elements.composer.hidden = true;
});
elements.resetPostForm.addEventListener("click", resetComposer);

elements.postForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const postId = elements.postId.value;
  const payload = {
    title: elements.postTitle.value,
    excerpt: elements.postExcerpt.value,
    content: elements.postContent.value
  };

  try {
    await api(postId ? `/api/posts/${postId}` : "/api/posts", {
      method: postId ? "PUT" : "POST",
      body: JSON.stringify(payload)
    });
    resetComposer();
    elements.composer.hidden = true;
    await loadPosts();
    toast(postId ? "Post updated." : "Post published.");
  } catch (error) {
    toast(error.message);
  }
});

elements.searchInput.addEventListener("input", (event) => {
  state.search = event.target.value;
  renderPosts();
});

elements.posts.addEventListener("click", async (event) => {
  const editButton = event.target.closest("[data-edit-post]");
  const deletePostButton = event.target.closest("[data-delete-post]");
  const deleteCommentButton = event.target.closest("[data-delete-comment]");

  try {
    if (editButton) {
      const post = state.posts.find((item) => item.id === editButton.dataset.editPost);
      openComposer(post);
    }

    if (deletePostButton && confirm("Delete this post and its comments?")) {
      await api(`/api/posts/${deletePostButton.dataset.deletePost}`, { method: "DELETE" });
      await loadPosts();
      toast("Post deleted.");
    }

    if (deleteCommentButton) {
      await api(`/api/comments/${deleteCommentButton.dataset.deleteComment}`, { method: "DELETE" });
      await loadPosts();
      toast("Comment deleted.");
    }
  } catch (error) {
    toast(error.message);
  }
});

elements.posts.addEventListener("submit", async (event) => {
  const form = event.target.closest("[data-comment-form]");
  if (!form) return;
  event.preventDefault();

  const textarea = form.querySelector("textarea");
  try {
    await api(`/api/posts/${form.dataset.commentForm}/comments`, {
      method: "POST",
      body: JSON.stringify({ content: textarea.value })
    });
    textarea.value = "";
    await loadPosts();
    toast("Comment added.");
  } catch (error) {
    toast(error.message);
  }
});

boot().catch((error) => toast(error.message));
