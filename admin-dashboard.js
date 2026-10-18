const API = "http://127.0.0.1:8000/api";
let accessToken = localStorage.getItem("me_access") || "";
let isSuperuser = false;
let configuredPaymentInstructions = "";
const $ = (id) => document.getElementById(id);
const queues = {
  campaigns: {
    path: "/admin/review/campaigns/",
    list: "campaignReviewList",
    count: "campaignCount",
    status: "PENDING",
    empty: "No creator task submissions are waiting for review.",
    render: renderCampaigns,
  },
  payments: {
    path: "/admin/review/payments/",
    list: "paymentReviewList",
    count: "paymentCount",
    status: ["PENDING", "AWAITING_PAYMENT", "UNDER_REVIEW"],
    empty: "No payment requests are waiting for review.",
    render: renderPayments,
  },
  withdrawals: {
    path: "/admin/review/withdrawals/",
    list: "withdrawalReviewList",
    count: "withdrawalCount",
    status: "PENDING",
    empty: "No withdrawals are waiting for review.",
    render: renderWithdrawals,
  },
  "task-answers": {
    path: "/admin/review/task-answers/",
    list: "taskReviewList",
    count: "taskCount",
    status: "SUBMITTED",
    empty: "No task answers are waiting for review.",
    render: renderTaskClaims,
  },
};

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[char]));
const money = (value) => "KSh " + Number(value || 0).toLocaleString("en-KE", {maximumFractionDigits: 2});

function setMessage(message, el = "adminMessage") {
  $(el).textContent = message || "";
}

function setAdminStatus(message) {
  setMessage(message, "adminStatus");
}

function headers(json = true) {
  const result = {};
  if (json) result["Content-Type"] = "application/json";
  if (accessToken) result.Authorization = "Bearer " + accessToken;
  return result;
}

async function api(path, options = {}) {
  const isFormData = options.body instanceof FormData;
  const response = await fetch(API + path, {
    ...options,
    headers: { ...headers(options.body !== undefined && !isFormData), ...(options.headers || {}) },
  });
  let data = {};
  try { data = await response.json(); } catch {}
  if (!response.ok) {
    const errors = Object.values(data).flatMap((value) => Array.isArray(value) ? value : [value]).filter((value) => typeof value === "string");
    const error = new Error(typeof data.detail === "string" ? data.detail : errors.join(" ") || response.statusText || "Request failed");
    error.status = response.status;
    throw error;
  }
  return data;
}

function showAuth(show) {
  $("adminAuth").hidden = !show;
  $("adminDashboard").hidden = show;
}

function clearCredentials() {
  accessToken = "";
  localStorage.removeItem("me_access");
  localStorage.removeItem("me_refresh");
}

async function ensureAdmin() {
  if (!accessToken) {
    showAuth(true);
    return false;
  }
  try {
    const user = await api("/me/");
    if (!user.is_staff) {
      clearCredentials();
      setMessage("This account does not have admin access. Sign in with a staff account.");
      showAuth(true);
      return false;
    }
    isSuperuser = Boolean(user.is_superuser);
    showAuth(false);
    return true;
  } catch (error) {
    if (error.status === 401 || error.status === 403) clearCredentials();
    setMessage(error.status ? error.message : `Could not verify admin access: ${error.message}`);
    showAuth(true);
    return false;
  }
}

function uniquePendingItems(items, status) {
  const statuses = Array.isArray(status) ? status : [status];
  const seen = new Set();
  return (Array.isArray(items) ? items : []).filter((item) => {
    if (!item || !statuses.includes(item.status) || item.id == null) return false;
    const id = String(item.id);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

async function refreshQueue(kind, announce = true) {
  const queue = queues[kind];
  try {
    const items = uniquePendingItems(await api(queue.path), queue.status);
    queue.render(items);
    $(queue.count).textContent = String(items.length);
    if (announce) setAdminStatus("");
    return true;
  } catch (error) {
    if (error.status === 401 || error.status === 403) {
      clearCredentials();
      setMessage("Your admin session has expired or no longer has access. Please sign in again.");
      showAuth(true);
      return false;
    }
    $(queue.list).innerHTML = `<p class="queue-error" role="alert">Could not load this queue: ${esc(error.message)}</p>`;
    $(queue.count).textContent = "—";
    setAdminStatus(`Could not load ${kind}: ${error.message}`);
    return false;
  }
}

async function loadAll() {
  if (!(await ensureAdmin())) return;
  await Promise.all([
    ...Object.keys(queues).map((kind) => refreshQueue(kind, false)),
    loadManagedCampaigns(),
    loadConfiguration(),
  ]);
}

function reviewCard({ title, detail, status, content, note, kind, id }) {
  return `
    <article class="review-card">
      <div class="review-heading">
        <div class="review-identity">
          <strong>${title}</strong>
          <p class="muted">${detail}</p>
        </div>
        <span class="pill review-status">${esc(status)}</span>
      </div>
      ${content}
      <p class="review-note">${esc(note || "No admin note yet.")}</p>
      <label class="review-note-field">Admin note (optional)<textarea data-admin-note rows="2"></textarea></label>
      <div class="action-list review-actions">
        <button class="button" data-kind="${esc(kind)}" data-action="APPROVED" data-id="${esc(id)}">Approve</button>
        <button class="outline" data-kind="${esc(kind)}" data-action="REJECTED" data-id="${esc(id)}">Reject</button>
      </div>
    </article>
  `;
}

function safeCampaignUrl(value) {
  try {
    const candidate = String(value ?? "").trim();
    if (!candidate) return "";
    const normalized = candidate.startsWith("//")
      ? `https:${candidate}`
      : /^[a-z][a-z\d+.-]*:/i.test(candidate)
        ? candidate
        : `https://${candidate}`;
    const url = new URL(normalized);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : "";
  } catch {
    return "";
  }
}

function renderCampaigns(items) {
  $("campaignReviewList").innerHTML = items.length ? items.map((item) => {
    const url = safeCampaignUrl(item.url);
    return reviewCard({
      kind: "campaigns",
      id: item.id,
      title: esc(item.title || "Untitled campaign"),
      detail: `${esc(item.creator_username)} · ${esc(item.platform)} ${esc(item.content_type)} · ${esc(item.objective)}`,
      status: item.status,
      content: `<p class="muted">${item.is_free_trial ? "Free trial task · package fee waived" : `Package: ${esc(item.budget)}`}${item.media_seconds ? ` · Video duration: ${esc(item.media_seconds)}s` : ""} · ${url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">Open content link ↗</a>` : "No valid content link"}</p>`,
      note: item.admin_note,
    });
  }).join("") : `<p class="queue-empty">${queues.campaigns.empty}</p>`;
}

async function loadManagedCampaigns() {
  try {
    const response = await api("/admin/review/campaigns/");
    const items = Array.isArray(response) ? response : response?.results;
    if (!Array.isArray(items)) throw new Error("Unexpected campaign inventory response.");
    const manageable = items.filter((item) => item.status !== "PENDING");
    $("managedCampaignList").innerHTML = manageable.length ? manageable.map((item) => {
      const url = safeCampaignUrl(item.url);
      const expires = item.subscription_until ? formatDate(item.subscription_until) : "Not subscribed";
      const removal = item.status === "APPROVED"
        ? `<label class="review-note-field">Notice to creator (required)<textarea data-removal-note rows="2" required></textarea></label>
          <button class="outline" data-remove-campaign data-id="${esc(item.id)}">Remove campaign</button>`
        : `<p class="review-note">${esc(item.admin_note || "No admin notice.")}</p>`;
      return `<article class="review-card">
        <div class="review-heading"><div class="review-identity"><strong>${esc(item.title || "Untitled campaign")}</strong><p class="muted">${esc(item.creator_username)} · ${esc(item.platform)} · ${esc(item.objective)}</p></div><span class="pill review-status">${esc(item.status)}</span></div>
        <p class="muted">${item.is_free_trial ? "Free trial package" : "Package"}: ${esc(item.target_quantity)} units · ${item.is_free_trial ? "fee waived" : money(item.budget)} · ${esc(item.subscription_days)} days · Subscription ends: ${esc(expires)}</p>
        <p class="muted">${url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">Open campaign link ↗</a>` : "No valid campaign link"}</p>
        ${removal}
      </article>`;
    }).join("") : `<p class="queue-empty">No campaigns have left the review queue yet.</p>`;
    return true;
  } catch (error) {
    $("managedCampaignList").innerHTML = `<p class="queue-error" role="alert">Could not load campaign inventory: ${esc(error.message)}</p>`;
    setAdminStatus(`Could not load campaign inventory: ${error.message}`);
    return false;
  }
}

function renderPayments(items) {
  $("paymentReviewList").innerHTML = items.length ? items.map((item) => {
    const evidence = item.evidence_screenshot_url
      ? `<a class="payment-evidence" href="#" data-view-payment-evidence="${esc(item.id)}">Open payment screenshot ↗</a>`
      : `<p class="muted">No screenshot submitted yet.</p>`;
    const instructionsForm = item.status === "PENDING" && isSuperuser
      ? `<div class="payment-instructions"><label class="review-note-field">Payment instructions to send<textarea data-payment-details rows="3" required>${esc(configuredPaymentInstructions)}</textarea></label><button class="button" type="button" data-send-instructions data-id="${esc(item.id)}">Send payment details</button></div>`
      : "";
    const actions = item.status === "UNDER_REVIEW"
      ? `<div class="action-list review-actions"><button class="button" data-kind="payments" data-action="APPROVED" data-id="${esc(item.id)}">Approve payment</button><button class="outline" data-kind="payments" data-action="REJECTED" data-id="${esc(item.id)}">Reject</button></div>`
      : item.status === "AWAITING_PAYMENT" || item.status === "PENDING"
        ? `<div class="action-list review-actions"><button class="outline" data-kind="payments" data-action="REJECTED" data-id="${esc(item.id)}">Reject request</button></div>`
        : "";
    return `<article class="review-card">
      <div class="review-heading"><div class="review-identity"><strong>${esc(item.user)} · ${esc(item.request_type)}</strong><p class="muted">${esc(item.transaction_code || "No transaction code")}</p></div><span class="pill review-status">${esc(item.status)}</span></div>
      <p class="muted">Amount: ${esc(item.amount)}${item.campaign ? ` · Campaign #${esc(item.campaign)}` : ""} · ${esc(item.evidence_note || "No evidence note")}</p>
      ${evidence}
      ${item.admin_payment_details ? `<p class="muted">Instructions sent: ${esc(item.admin_payment_details)}</p>` : ""}
      <p class="review-note">${esc(item.admin_note || "No admin note yet.")}</p>
      <label class="review-note-field">Admin note (optional)<textarea data-admin-note rows="2"></textarea></label>
      ${instructionsForm}${actions}
    </article>`;
  }).join("") : `<p class="queue-empty">${queues.payments.empty}</p>`;
}

async function loadConfiguration() {
  try {
    const [budgets, questions] = await Promise.all([
      api("/admin/campaign-budgets/"),
      api("/admin/questions/"),
    ]);
    renderBudgetPackages(budgets);
    renderQuestions(questions);
    if (isSuperuser) {
      const [settings, levels] = await Promise.all([api("/admin/settings/"), api("/admin/levels/")]);
      $("superuserConfiguration").hidden = false;
      configuredPaymentInstructions = settings.payment_instructions || "";
      $("settingsForm").elements.creator_activation_fee.value = settings.creator_activation_fee;
      $("settingsForm").elements.free_campaign_slots.value = settings.free_campaign_slots;
      $("settingsForm").elements.withdrawal_threshold.value = settings.withdrawal_threshold;
      $("settingsForm").elements.payment_instructions.value = configuredPaymentInstructions;
      renderAdminLevels(levels);
    }
  } catch (error) {
    setAdminStatus(`Could not load admin configuration: ${error.message}`);
  }
}

function renderBudgetPackages(items) {
  $("budgetList").innerHTML = items.length ? items.map((item) => `<article class="admin-config-item">
    <strong>${esc(item.platform)} · ${esc(item.objective)}</strong>
    <p>${esc(item.quantity)} units for KSh ${esc(item.amount)} · ${esc(item.validity_days)} days · ${item.is_active ? "Active" : "Inactive"}</p>
    <button class="outline" data-budget-toggle data-id="${esc(item.id)}" data-active="${item.is_active}">${item.is_active ? "Deactivate" : "Activate"}</button>
  </article>`).join("") : `<p class="queue-empty">No campaign budget packages have been configured.</p>`;
}

function renderQuestions(items) {
  $("questionList").innerHTML = items.length ? items.map((item) => `<article class="admin-config-item">
    <strong>${esc(item.platform)} · ${item.is_active ? "Active" : "Inactive"}</strong><p>${esc(item.question)}</p>
    <button class="outline" data-question-toggle data-id="${esc(item.id)}" data-active="${item.is_active}">${item.is_active ? "Deactivate" : "Activate"}</button>
  </article>`).join("") : `<p class="queue-empty">No platform questions have been added.</p>`;
}

function renderAdminLevels(levels) {
  $("adminLevelList").innerHTML = levels.length ? levels.map((item) => `<article class="admin-config-item">
    <strong>${esc(item.name)} · KSh ${esc(item.fee)}</strong>
    <p>Daily ${esc(item.sample_daily_earning)} · 30 days ${esc(item.sample_30_day_earning)} · 60 days ${esc(item.sample_60_day_earning)}</p>
    <p>${esc(item.description || "No description")}</p>
    <button class="outline" data-level-edit="${esc(item.id)}">Edit</button>
    <button class="outline" data-level-delete="${esc(item.id)}">Delete</button>
  </article>`).join("") : `<p class="queue-empty">No engager levels configured.</p>`;
}

function renderWithdrawals(items) {
  $("withdrawalReviewList").innerHTML = items.length ? items.map((item) => reviewCard({
    kind: "withdrawals",
    id: item.id,
    title: esc(item.user),
    detail: esc(item.mpesa_number),
    status: item.status,
    content: `<p class="muted">Amount: ${esc(item.amount)}</p>`,
    note: item.admin_note,
  })).join("") : `<p class="queue-empty">${queues.withdrawals.empty}</p>`;
}

function renderTaskClaims(items) {
  $("taskReviewList").innerHTML = items.length ? items.map((item) => reviewCard({
    kind: "task-answers",
    id: item.id,
    title: `${esc(item.user)} · ${esc(item.campaign_title)}`,
    detail: `Task #${esc(item.task_id)} · Submitted: ${esc(formatDate(item.submitted_at))}`,
    status: item.status,
    content: `<p class="muted">Question: ${esc(item.question || "No question assigned")}</p><p class="review-answer">Answer: ${esc(item.answer || "No answer submitted yet.")}</p><p class="muted">Earning if approved: ${item.earning_on_approval === null ? "No subscribed level" : money(item.earning_on_approval)}</p>`,
    note: item.admin_note,
  })).join("") : `<p class="queue-empty">${queues["task-answers"].empty}</p>`;
}

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

$("budgetForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const formElement = event.currentTarget;
  const form = new FormData(formElement);
  try {
    await api("/admin/campaign-budgets/", {
      method: "POST",
      body: JSON.stringify({
        platform: form.get("platform"),
        objective: form.get("objective"),
        quantity: Number(form.get("quantity")),
        amount: form.get("amount"),
        validity_days: Number(form.get("validity_days")),
        is_active: true,
      }),
    });
    setMessage("Campaign budget package created.", "budgetMessage");
    formElement.reset();
    await loadConfiguration();
  } catch (error) {
    setMessage(error.message, "budgetMessage");
  }
});

$("questionForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const formElement = event.currentTarget;
  const form = new FormData(formElement);
  try {
    await api("/admin/questions/", {
      method: "POST",
      body: JSON.stringify({platform: form.get("platform"), question: form.get("question"), is_active: true}),
    });
    setMessage("Question added to the platform pool.", "questionMessage");
    formElement.reset();
    await loadConfiguration();
  } catch (error) {
    setMessage(error.message, "questionMessage");
  }
});

$("settingsForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    const settings = await api("/admin/settings/", {
      method: "PATCH",
      body: JSON.stringify({
        creator_activation_fee: form.get("creator_activation_fee"),
        free_campaign_slots: Number(form.get("free_campaign_slots")),
        withdrawal_threshold: form.get("withdrawal_threshold"),
        payment_instructions: form.get("payment_instructions"),
      }),
    });
    configuredPaymentInstructions = settings.payment_instructions || "";
    setMessage("Platform settings saved.", "settingsMessage");
  } catch (error) {
    setMessage(error.message, "settingsMessage");
  }
});

$("levelForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const formElement = event.currentTarget;
  const form = new FormData(formElement);
  const editId = formElement.dataset.editId;
  const payload = {
    name: form.get("name"),
    fee: form.get("fee"),
    sample_daily_earning: form.get("sample_daily_earning"),
    sample_30_day_earning: form.get("sample_30_day_earning"),
    sample_60_day_earning: form.get("sample_60_day_earning"),
    description: form.get("description"),
  };
  try {
    await api(editId ? `/admin/levels/${editId}/` : "/admin/levels/", {
      method: editId ? "PATCH" : "POST",
      body: JSON.stringify(payload),
    });
    delete formElement.dataset.editId;
    formElement.reset();
    formElement.querySelector("button[type=submit]").textContent = "Create level";
    setMessage(editId ? "Engager level updated." : "Engager level created.", "levelMessage");
    await loadConfiguration();
  } catch (error) {
    setMessage(error.message, "levelMessage");
  }
});

$("adminDashboard").addEventListener("click", async (event) => {
  const evidenceLink = event.target.closest("[data-view-payment-evidence]");
  if (evidenceLink) {
    event.preventDefault();
    const preview = window.open("about:blank", "_blank");
    if (!preview) {
      setAdminStatus("Allow pop-ups to view the payment screenshot.");
      return;
    }
    preview.opener = null;
    try {
      const response = await fetch(`${API}/admin/review/payments/${encodeURIComponent(evidenceLink.dataset.viewPaymentEvidence)}/evidence/`, {
        headers: headers(false),
      });
      if (!response.ok) {
        let detail = response.statusText || "Could not load the payment screenshot.";
        try {
          const error = await response.json();
          if (typeof error.detail === "string") detail = error.detail;
        } catch {}
        throw new Error(detail);
      }
      const objectUrl = URL.createObjectURL(await response.blob());
      preview.location.href = objectUrl;
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
    } catch (error) {
      preview.close();
      setAdminStatus(`Could not load payment screenshot: ${error.message}`);
    }
    return;
  }

  const sendButton = event.target.closest("[data-send-instructions]");
  if (sendButton) {
    const card = sendButton.closest(".review-card");
    const detailsField = card.querySelector("[data-payment-details]");
    const details = detailsField.value.trim();
    if (!details) {
      setAdminStatus("Enter payment instructions before sending them.");
      detailsField.focus();
      return;
    }
    sendButton.disabled = true;
    try {
      await api(`/admin/review/payments/${encodeURIComponent(sendButton.dataset.id)}/`, {
        method: "POST",
        body: JSON.stringify({
          status: "AWAITING_PAYMENT",
          admin_payment_details: details,
        }),
      });
      if (await refreshQueue("payments", false)) {
        setAdminStatus(`Payment instructions sent for request #${sendButton.dataset.id}.`);
      } else {
        setAdminStatus("Payment instructions were sent, but the payments queue could not be refreshed. Refresh to confirm.");
      }
    } catch (error) {
      sendButton.disabled = false;
      setAdminStatus(error.message);
    }
    return;
  }

  const removeCampaignButton = event.target.closest("[data-remove-campaign]");
  if (removeCampaignButton) {
    const card = removeCampaignButton.closest(".review-card");
    const notice = card.querySelector("[data-removal-note]").value.trim();
    if (!notice) {
      setAdminStatus("Enter a notice for the creator before removing this campaign.");
      return;
    }
    removeCampaignButton.disabled = true;
    try {
      await api(`/admin/review/campaigns/${encodeURIComponent(removeCampaignButton.dataset.id)}/`, {
        method: "POST",
        body: JSON.stringify({status: "REMOVED", admin_note: notice}),
      });
      await loadManagedCampaigns();
      await refreshQueue("campaigns", false);
      setAdminStatus(`Campaign #${removeCampaignButton.dataset.id} removed. The creator can see your notice.`);
    } catch (error) {
      removeCampaignButton.disabled = false;
      setAdminStatus(error.message);
    }
    return;
  }

  const budgetToggle = event.target.closest("[data-budget-toggle]");
  if (budgetToggle) {
    try {
      await api(`/admin/campaign-budgets/${budgetToggle.dataset.id}/`, {
        method: "PATCH",
        body: JSON.stringify({is_active: budgetToggle.dataset.active !== "true"}),
      });
      await loadConfiguration();
    } catch (error) { setAdminStatus(error.message); }
    return;
  }

  const questionToggle = event.target.closest("[data-question-toggle]");
  if (questionToggle) {
    try {
      await api(`/admin/questions/${questionToggle.dataset.id}/`, {
        method: "PATCH",
        body: JSON.stringify({is_active: questionToggle.dataset.active !== "true"}),
      });
      await loadConfiguration();
    } catch (error) { setAdminStatus(error.message); }
    return;
  }

  const levelEdit = event.target.closest("[data-level-edit]");
  if (levelEdit && isSuperuser) {
    try {
      const levels = await api("/admin/levels/");
      const level = levels.find((item) => item.id === Number(levelEdit.dataset.levelEdit));
      if (!level) throw new Error("This engager level could not be found.");
      const form = $("levelForm");
      form.dataset.editId = level.id;
      for (const field of ["name", "fee", "sample_daily_earning", "sample_30_day_earning", "sample_60_day_earning", "description"]) {
        form.elements[field].value = level[field] ?? "";
      }
      form.querySelector("button[type=submit]").textContent = "Save level";
      form.scrollIntoView({behavior: "smooth", block: "center"});
    } catch (error) { setMessage(error.message, "levelMessage"); }
    return;
  }

  const levelDelete = event.target.closest("[data-level-delete]");
  if (levelDelete && isSuperuser) {
    try {
      await api(`/admin/levels/${levelDelete.dataset.levelDelete}/`, {method: "DELETE"});
      setMessage("Engager level deleted.", "levelMessage");
      await loadConfiguration();
    } catch (error) { setMessage(error.message, "levelMessage"); }
  }
});

$("adminDashboard").addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-kind]");
  if (!button || button.disabled) return;
  const kind = button.dataset.kind;
  const queue = queues[kind];
  const card = button.closest(".review-card");
  const buttons = card.querySelectorAll(".review-actions button");
  buttons.forEach((actionButton) => { actionButton.disabled = true; });
  try {
    const result = await api(`${queue.path}${encodeURIComponent(button.dataset.id)}/`, {
      method: "POST",
      body: JSON.stringify({
        status: button.dataset.action,
        admin_note: card.querySelector("[data-admin-note]").value,
      }),
    });
    if (await refreshQueue(kind, false)) {
      if (kind === "campaigns") await loadManagedCampaigns();
      setAdminStatus(`${kind} #${button.dataset.id} status: ${result.status}.`);
    }
  } catch (error) {
    if (error.status === 401 || error.status === 403) {
      clearCredentials();
      setMessage("Your admin session has expired or no longer has access. Please sign in again.");
      showAuth(true);
      return;
    }
    buttons.forEach((actionButton) => { actionButton.disabled = false; });
    setAdminStatus(error.message);
  }
});

$("adminLoginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    const data = await api("/auth/token/", {
      method: "POST",
      body: JSON.stringify({
        username: form.get("username"),
        password: form.get("password"),
      }),
    });
    accessToken = data.access;
    localStorage.setItem("me_access", data.access);
    localStorage.setItem("me_refresh", data.refresh);
    setMessage("Signed in. Checking admin access…");
    await loadAll();
  } catch (error) {
    setMessage(error.message);
  }
});

$("logoutBtn").addEventListener("click", () => {
  clearCredentials();
  showAuth(true);
  setMessage("Signed out.");
});

document.querySelectorAll("[data-refresh-queue]").forEach((button) => {
  button.addEventListener("click", () => refreshQueue(button.dataset.refreshQueue));
});

$("refreshManagedCampaigns").addEventListener("click", () => loadManagedCampaigns());

if (accessToken) loadAll();
