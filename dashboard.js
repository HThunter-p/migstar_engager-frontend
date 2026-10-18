const API = "http://127.0.0.1:8000/api";
let accessToken = localStorage.getItem("me_access") || "";
let levelsCache = [];
let budgetPackages = [];
let currentUser = null;
let activeRole = null;
const $ = (selector) => document.querySelector(selector);
const money = (value) => "KSh " + Number(value || 0).toLocaleString("en-KE", {maximumFractionDigits: 2});
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));

function headers(json=true) {
  const result = {};
  if (json) result["Content-Type"] = "application/json";
  if (accessToken) result.Authorization = "Bearer " + accessToken;
  return result;
}

async function api(path, options={}) {
  const isFormData = options.body instanceof FormData;
  const response = await fetch(API + path, {
    ...options,
    headers: {...headers(options.body !== undefined && !isFormData), ...(options.headers || {})},
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

function showMessage(message) {
  $("#dashboardMessage").textContent = message;
}

function actionForm(html) {
  $("#actionArea").innerHTML = `<div class="inline-form">${html}</div>`;
  showMessage("");
}

function showAuthError(error) {
  localStorage.removeItem("me_access");
  localStorage.removeItem("me_refresh");
  const destination = new URL("index.html#account", window.location.href);
  destination.searchParams.set("notice", error);
  window.location.replace(destination.href);
}

function renderUser(user) {
  currentUser = user;
  const roles = user.roles || [];
  const creator = roles.includes("CREATOR");
  const engager = roles.includes("ENGAGER");
  if (!roles.includes(activeRole)) activeRole = creator ? "CREATOR" : engager ? "ENGAGER" : null;
  const activeCreator = activeRole === "CREATOR";
  const activeEngager = activeRole === "ENGAGER";
  document.querySelectorAll("[data-role]").forEach((element) => {
    element.hidden = !roles.includes(element.dataset.role) || element.dataset.role !== activeRole;
  });
  document.querySelectorAll("[data-feature='campaigns']").forEach((element) => {
    element.hidden = !activeCreator;
  });
  $("#switchRoleBtn").hidden = !roles.length;
  $("#switchRoleBtn").textContent = `Switch to ${activeCreator ? "Engager" : "Creator"}`;
  $("#roleSwitchHint").textContent = activeRole
    ? `Currently using your ${activeCreator ? "creator" : "engager"} workspace. Switch roles any time.`
    : "Choose a role by registering for a creator or engager account.";
  $("#userGreeting").textContent = `Welcome, ${user.username}`;
  $("#balance").textContent = money(user.demo_balance);
  $("#creatorStatus").textContent = creator ? (user.creator_active ? "Active" : "Needs activation") : "Not enabled";
  const freeCampaignsRemaining = Number(user.free_campaigns_remaining || 0);
  const freeCampaignSlots = Number(user.free_campaign_slots || 0);
  $("#creatorSummary").textContent = creator
    ? (user.creator_active
      ? `${freeCampaignsRemaining} free campaign trial${freeCampaignsRemaining === 1 ? "" : "s"} remaining. Paid campaign packages apply after your trials.`
      : `Pay the one-time activation fee to unlock ${freeCampaignSlots} free campaign trial${freeCampaignSlots === 1 ? "" : "s"}. Campaign package fees apply afterward.`)
    : "This role is not on your account.";
  $("#engagerStatus").textContent = engager ? (user.engager_active ? "Active" : "Needs activation") : "Not enabled";
  const subscribedLevel = user.selected_level_name
    ? `Subscribed level: ${user.selected_level_name} · ${money(user.selected_level_fee)}.`
    : "";
  $("#engagerSummary").textContent = engager
    ? `${user.engager_active ? "You can claim available tasks." : "Choose a level and request activation."}${subscribedLevel ? ` ${subscribedLevel}` : ""}`
    : "This role is not on your account.";
  $("#profileUsername").textContent = user.username;
  $("#profileRoles").textContent = roles.map((role) => role === "CREATOR" ? "Creator" : "Engager").join(", ") || "None";
  $("#profileReferral").textContent = user.referral_code || "—";
  $("#creatorPaymentBtn").hidden = !activeCreator || user.creator_active;
  $("#levelPaymentBtn").hidden = !activeEngager || user.engager_active || Boolean(user.selected_level_id);
  $("#campaignFormBtn").hidden = !activeCreator || !user.creator_active;
  if (creator && user.creator_active) {
    $("#campaignFormBtn").innerHTML = freeCampaignsRemaining
      ? `Create task · ${freeCampaignsRemaining} free trial${freeCampaignsRemaining === 1 ? "" : "s"} left <span>→</span>`
      : "Create a paid task <span>→</span>";
  }
  if (budgetPackages.length) renderCampaignBudgets(budgetPackages);
  $("#tasksBtn").hidden = !activeEngager || !user.engager_active;
  $("#withdrawBtn").hidden = !activeEngager;
}

async function loadDashboard() {
  if (!accessToken) {
    showAuthError("Please sign in to view your dashboard.");
    return;
  }
  try {
    const user = await api("/me/");
    renderUser(user);
    let campaigns = null;
    if ((user.roles || []).includes("CREATOR")) {
      try {
        campaigns = await api("/campaigns/");
        renderCampaigns(campaigns);
      } catch (error) {
        $("#campaignList").innerHTML = `<p class="message">Could not load campaigns: ${esc(error.message)}</p>`;
      }
    }
    if ((user.roles || []).includes("ENGAGER")) {
      try {
        levelsCache = await api("/levels/");
      } catch (error) {
        levelsCache = [];
        showMessage(`Your account loaded, but available subscription choices could not be loaded: ${error.message}`);
      }
    }
    if ((user.roles || []).includes("CREATOR")) {
      try {
        budgetPackages = await api("/campaign-budgets/");
        renderCampaignBudgets(budgetPackages);
      } catch (error) {
        budgetPackages = [];
        $("#campaignBudgetList").innerHTML = `<p class="message">Could not load campaign packages: ${esc(error.message)}</p>`;
        showMessage(`Campaign budget packages could not be loaded: ${error.message}`);
      }
    }
    await loadPaymentRequests();
    if (campaigns) renderCampaigns(campaigns);
  } catch (error) {
    if (error.status === 401 || error.status === 403) showAuthError(error.message);
    else showMessage(`Could not load your account: ${error.message}`);
  }
}

function renderCampaigns(data) {
  const allCampaigns = Array.isArray(data) ? data : data.results || [];
  const campaigns = currentUser && (currentUser.roles || []).includes("CREATOR")
    ? allCampaigns.filter((campaign) => campaign.creator === currentUser.id)
    : allCampaigns;
  $("#campaignList").innerHTML = campaigns.length ? campaigns.map((campaign) => {
    const owned = currentUser && campaign.creator === currentUser.id;
    const expires = campaign.subscription_until ? new Date(campaign.subscription_until) : null;
    const subscriptionLive = expires && expires > new Date();
    const paymentPending = paymentRequests.some((payment) =>
      payment.campaign === campaign.id && ["PENDING", "AWAITING_PAYMENT", "UNDER_REVIEW"].includes(payment.status)
    );
    const subscriptionMessage = campaign.budget_package
      ? `${owned ? `${campaign.is_free_trial ? "Free trial package" : `Your package: ${esc(campaign.target_quantity)} units · ${money(campaign.budget)}`} · ` : `${esc(campaign.target_quantity)} units/package · `}Subscription ${subscriptionLive ? `active until ${esc(expires.toLocaleString())}` : "expired or not activated"} · ${esc(campaign.subscription_days)} days per renewal${paymentPending ? " · Payment request pending" : ""}`
      : "";
    const renewButton = owned && campaign.budget_package && campaign.status === "APPROVED" && !subscriptionLive && !paymentPending
      ? `<button class="button" data-subscribe-campaign="${campaign.id}" data-amount="${esc(campaign.budget)}">Subscribe / renew · ${money(campaign.budget)}</button>`
      : "";
    const canUseWallet = currentUser && (currentUser.roles || []).includes("CREATOR") && (currentUser.roles || []).includes("ENGAGER");
    const walletBalance = Number(currentUser && currentUser.demo_balance || 0);
    const walletButton = canUseWallet && owned && campaign.budget_package && campaign.status === "APPROVED" && !subscriptionLive && !paymentPending
      ? `<button class="outline" data-wallet-fund-campaign="${campaign.id}" ${walletBalance < Number(campaign.budget) ? "disabled" : ""}>${walletBalance < Number(campaign.budget) ? `Insufficient wallet funds · ${money(campaign.budget)}` : `Fund from engager wallet · ${money(campaign.budget)}`}</button>`
      : "";
    return `<article class="campaign-card">${campaign.thumbnail_url ? `<img loading="lazy" src="${esc(campaign.thumbnail_url)}" alt="">` : `<div class="campaign-placeholder">✦</div>`}<div class="campaign-body"><span class="pill">${esc(campaign.platform)} · ${esc(campaign.objective)}</span><p class="muted">Approval status: <strong>${esc(campaign.status)}</strong></p><h3>${esc(campaign.title || "Campaign awaiting metadata")}</h3><p>${esc(campaign.description || "Review the campaign details before participating.")}</p>${campaign.admin_note ? `<p class="muted">${esc(campaign.admin_note)}</p>` : ""}${subscriptionMessage ? `<p class="muted">${subscriptionMessage}</p>` : ""}<a class="button secondary" target="_blank" rel="noopener noreferrer" href="${esc(campaign.url)}">Open content ↗</a>${renewButton}${walletButton}</div></article>`;
  }).join("") : "<p class='muted'>No campaigns are available yet. Approved campaigns will appear here.</p>";
}

async function refreshCampaignData() {
  paymentRequests = await api("/payment-requests/");
  const campaigns = await api("/campaigns/");
  renderCampaigns(campaigns);
  return campaigns;
}

function renderCampaignBudgets(packages) {
  const trialAvailable = currentUser && Number(currentUser.free_campaigns_remaining || 0) > 0;
  $("#campaignBudgetList").innerHTML = packages.length ? packages.map((item) => `<article class="level-card">
    <span class="pill">${esc(item.platform)} · ${esc(item.objective)}</span>
    <h3>${esc(item.quantity)} ${esc(item.objective.toLowerCase())}</h3>
    <div class="price">${trialAvailable ? "Free trial" : money(item.amount)} <small>/ package${trialAvailable ? ` · ${money(item.amount)} waived` : ""}</small></div>
    <p>Campaign subscription duration: ${esc(item.validity_days)} days.</p>
  </article>`).join("") : "<p class='muted'>No campaign packages are available yet.</p>";
}

async function requestPayment(type, amount, level, campaign = null) {
  try {
    const payload = {request_type: type, amount};
    if (level != null) payload.level = level;
    if (campaign != null) payload.campaign = campaign;
    await api("/payment-requests/", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    await loadPaymentRequests();
    showPaymentRequests();
    if (type === "CAMPAIGN_BUDGET") {
      try {
        await refreshCampaignData();
      } catch (error) {
        showMessage(`Request submitted, but campaign status could not be refreshed: ${error.message}`);
        return;
      }
    }
    showMessage("Request submitted. The super admin will provide payment instructions here.");
    await refreshUser();
  } catch (error) {
    showMessage(error.message);
  }
}

let paymentRequests = [];
async function loadPaymentRequests() {
  try {
    paymentRequests = await api("/payment-requests/");
    return paymentRequests;
  } catch (error) {
    showMessage(`Could not load payment requests: ${error.message}`);
    return [];
  }
}

function showPaymentRequests() {
  if (!paymentRequests.length) {
    $("#actionArea").innerHTML = "<p class='muted'>You have no payment requests yet.</p>";
    return;
  }
  $("#actionArea").innerHTML = paymentRequests.map((payment) => {
    const requestDetails = payment.admin_payment_details
      ? `<p class="muted"><b>Payment instructions:</b><br>${esc(payment.admin_payment_details).replace(/\n/g, "<br>")}</p>`
      : "<p class='muted'>Waiting for the super admin to provide payment instructions.</p>";
    const evidenceForm = payment.status === "AWAITING_PAYMENT"
      ? `<form class="inline-form" data-payment-evidence="${payment.id}">
          <label>M-Pesa transaction code<input name="transaction_code" maxlength="80" required></label>
          <label>Payment screenshot<input name="screenshot" type="file" accept="image/png,image/jpeg,image/gif,image/webp" required></label>
          <button class="button" type="submit">Submit payment evidence</button>
        </form>`
      : "";
    const statusMessage = payment.status === "PENDING" ? "Admin instructions are pending."
      : payment.status === "UNDER_REVIEW" ? "Payment evidence received and awaiting admin verification."
      : payment.status === "APPROVED" ? "Payment approved."
      : payment.status === "REJECTED" ? `Request rejected. ${esc(payment.admin_note || "You may submit a new request if needed.")}`
      : "";
    return `<article class="inline-form"><b>${esc(payment.request_type)} · ${money(payment.amount)}</b>
      <span class="pill">${esc(payment.status)}</span>${requestDetails}
      <p class="muted">${statusMessage}</p>${evidenceForm}</article>`;
  }).join("");
}

async function refreshUser() {
  try {
    renderUser(await api("/me/"));
  } catch (error) {
    showMessage(error.message);
  }
}

$("#logoutBtn").addEventListener("click", () => {
  localStorage.removeItem("me_access");
  localStorage.removeItem("me_refresh");
  window.location.assign("index.html");
});

$("#switchRoleBtn").addEventListener("click", async () => {
  if (!currentUser) return;
  const targetRole = activeRole === "CREATOR" ? "ENGAGER" : "CREATOR";
  const roles = currentUser.roles || [];
  if (roles.includes(targetRole)) {
    activeRole = targetRole;
    renderUser(currentUser);
    showMessage(`Switched to your ${targetRole === "CREATOR" ? "creator" : "engager"} workspace.`);
    return;
  }
  const button = $("#switchRoleBtn");
  button.disabled = true;
  try {
    await api("/me/switch-role/", {
      method: "POST",
      body: JSON.stringify({role: targetRole}),
    });
    activeRole = targetRole;
    await loadDashboard();
    showMessage(`${targetRole === "CREATOR" ? "Creator" : "Engager"} role added. Complete its activation steps to use all features.`);
  } catch (error) {
    showMessage(`Could not switch roles: ${error.message}`);
  } finally {
    button.disabled = false;
  }
});

$("#refreshCampaigns").addEventListener("click", async () => {
  try {
    await refreshCampaignData();
    showMessage("Campaign and subscription status refreshed.");
  } catch (error) {
    showMessage(`Could not load campaigns: ${error.message}`);
  }
});

$("#paymentRequestsBtn").addEventListener("click", async () => {
  await loadPaymentRequests();
  showPaymentRequests();
});

$("#actionArea").addEventListener("submit", async (event) => {
  const form = event.target.closest("form[data-payment-evidence]");
  if (!form) return;
  event.preventDefault();
  const data = new FormData(form);
  const submitButton = form.querySelector("button[type=submit]");
  submitButton.disabled = true;
  try {
    await api(`/payment-requests/${form.dataset.paymentEvidence}/submit-evidence/`, {
      method: "POST",
      body: data,
    });
    await loadPaymentRequests();
    showPaymentRequests();
    showMessage("Payment evidence submitted. An admin will verify it.");
  } catch (error) {
    submitButton.disabled = false;
    showMessage(error.message);
  }
});

$("#campaignList").addEventListener("click", async (event) => {
  const walletButton = event.target.closest("[data-wallet-fund-campaign]");
  if (walletButton) {
    walletButton.disabled = true;
    try {
      const result = await api("/wallet/fund-campaign/", {
        method: "POST",
        body: JSON.stringify({campaign: Number(walletButton.dataset.walletFundCampaign)}),
      });
      renderUser(await api("/me/"));
      renderCampaigns(await api("/campaigns/"));
      showMessage(`Campaign funded from your engager wallet. New balance: ${money(result.demo_balance)}.`);
    } catch (error) {
      walletButton.disabled = false;
      showMessage(error.message);
    }
    return;
  }
  const button = event.target.closest("[data-subscribe-campaign]");
  if (!button) return;
  button.disabled = true;
  try {
    const campaignId = Number(button.dataset.subscribeCampaign);
    const campaigns = await refreshCampaignData();
    const campaign = campaigns.find((item) => item.id === campaignId);
    if (campaign?.subscription_until && Date.parse(campaign.subscription_until) > Date.now()) {
      showMessage("This campaign subscription is already active. Its status has been refreshed.");
      return;
    }
    if (paymentRequests.some((payment) =>
      payment.campaign === campaignId && ["PENDING", "AWAITING_PAYMENT", "UNDER_REVIEW"].includes(payment.status)
    )) {
      showMessage("A campaign payment request is already pending. Its status has been refreshed.");
      return;
    }
    await requestPayment(
      "CAMPAIGN_BUDGET",
      button.dataset.amount,
      null,
      campaignId,
    );
  } catch (error) {
    showMessage(`Could not refresh campaign status: ${error.message}`);
  } finally {
    if (button.isConnected) button.disabled = false;
  }
});

$("#creatorPaymentBtn").addEventListener("click", async () => {
  try {
    const settings = await api("/settings/");
    actionForm(`<b>Creator activation request</b><p class="muted">One-time activation fee: ${money(settings.creator_activation_fee)}. Once activated, you receive ${settings.free_campaign_slots} free campaign trials; normal campaign fees apply afterward. Payment details will be provided by the super admin.</p><button class="button" id="sendPay">Request activation</button>`);
    $("#sendPay").onclick = () => requestPayment("CREATOR_ACTIVATION", settings.creator_activation_fee, null);
  } catch (error) { showMessage(error.message); }
});

$("#levelPaymentBtn").addEventListener("click", () => {
  if (!levelsCache.length) {
    showMessage("No active levels are available right now.");
    return;
  }
  actionForm(`<b>One-time engager level subscription</b><label>Choose level<select id="chosenLevel">${levelsCache.map((level) => `<option value="${level.id}">${esc(level.name)} — ${money(level.fee)}</option>`).join("")}</select></label><p class="muted">This is a one-time payment. Your engager access remains active after approval.</p><button class="button" id="sendLevelPay">Request level activation</button>`);
  $("#sendLevelPay").onclick = () => {
    const level = levelsCache.find((item) => item.id === Number($("#chosenLevel").value));
    if (level) requestPayment("ENGAGER_LEVEL", level.fee, level.id);
  };
});

$("#campaignFormBtn").addEventListener("click", () => {
  const freeTrial = Number(currentUser.free_campaigns_remaining || 0) > 0;
  const freeCampaignSlots = Number(currentUser.free_campaign_slots || 0);
  actionForm(`<b>Create an engager task</b><p class="muted">${freeTrial ? "This task uses one of your free campaign trials. The selected package fee is waived." : "Your free campaign trials are used. The selected package fee is due after task approval."}</p><label>Platform<select id="cPlatform"><option value="YOUTUBE">YouTube</option><option value="FACEBOOK">Facebook</option><option value="INSTAGRAM">Instagram</option><option value="TIKTOK">TikTok</option></select></label><label>Content type<select id="cContentType"></select></label><label>Objective<select id="cObjective"><option value="VIEWERS">Views</option><option value="FOLLOWERS">Followers</option><option value="LIKES">Likes</option><option value="COMMENTS">Comments</option><option value="SUBSCRIBERS">Subscribers</option><option value="WEBSITE_VISITS">Website visits</option><option value="SURVEY">Survey/feedback</option><option value="QUIZ">Educational quiz</option><option value="REFERRALS">Legitimate referrals</option></select></label><label>Campaign package<select id="cBudgetPackage" required></select></label><label>Public HTTPS content URL<input id="cUrl" type="url" required placeholder="https://..."></label><label id="videoDurationField" hidden>Video duration in seconds (only needed if it cannot be detected)<input id="cMediaSeconds" type="number" min="1" step="1"></label><label>Profile URL (if relevant)<input id="cProfile" type="url"></label><label>Description / instructions<textarea id="cDesc"></textarea></label><button class="button" id="sendCampaign">Submit task for review</button><small class="muted">Profile, post, and channel tasks take 20 seconds. Reels, videos, Shorts, and challenges use the full video duration. Tasks are reviewed before becoming available. Your first ${freeCampaignSlots} packages are free after activation; subsequent packages require payment after approval.</small>`);
  const contentTypes = {
    YOUTUBE: [["CHANNEL", "Channel"], ["VIDEO", "Video"], ["SHORT", "Short"]],
    FACEBOOK: [["PROFILE", "Profile"], ["POST", "Post"], ["REEL", "Reel"]],
    INSTAGRAM: [["PROFILE", "Profile"], ["POST", "Post"], ["REEL", "Reel"]],
    TIKTOK: [["PROFILE", "Profile"], ["CHALLENGE", "Challenge"]],
  };
  const contentTypeSelect = $("#cContentType");
  const durationField = $("#videoDurationField");
  const mediaSecondsInput = $("#cMediaSeconds");
  const updateContentTypes = () => {
    contentTypeSelect.innerHTML = contentTypes[$("#cPlatform").value]
      .map(([value, label]) => `<option value="${value}">${label}</option>`)
      .join("");
    updateDurationField();
  };
  const updateDurationField = () => {
    const needsVideoDuration = ["VIDEO", "SHORT", "REEL", "CHALLENGE"].includes(contentTypeSelect.value);
    durationField.hidden = !needsVideoDuration;
  };
  const packageSelect = $("#cBudgetPackage");
  const updatePackages = () => {
    const options = budgetPackages.filter((item) => item.platform === $("#cPlatform").value && item.objective === $("#cObjective").value);
    packageSelect.innerHTML = options.map((item) => `<option value="${item.id}">${esc(item.quantity)} ${esc(item.objective.toLowerCase())} · ${freeTrial ? "Free trial" : money(item.amount)} · ${esc(item.validity_days)} days</option>`).join("") || `<option value="">No package available</option>`;
  };
  $("#cPlatform").addEventListener("change", updatePackages);
  $("#cObjective").addEventListener("change", updatePackages);
  $("#cPlatform").addEventListener("change", updateContentTypes);
  contentTypeSelect.addEventListener("change", updateDurationField);
  updatePackages();
  updateContentTypes();
  $("#sendCampaign").onclick = async () => {
    try {
      const packageId = Number(packageSelect.value);
      if (!packageId) throw new Error("An active budget package is required for this platform and objective.");
      const mediaSeconds = Number(mediaSecondsInput.value);
      const campaign = await api("/campaigns/", {
        method: "POST",
        body: JSON.stringify({
          platform: $("#cPlatform").value,
          content_type: contentTypeSelect.value,
          objective: $("#cObjective").value,
          budget_package: packageId,
          url: $("#cUrl").value,
          media_seconds: mediaSeconds || null,
          profile_url: $("#cProfile").value,
          description: $("#cDesc").value,
        }),
      });
      await refreshUser();
      $("#actionArea").innerHTML = `<p class="message">Task submitted for review. Status: ${esc(campaign.status)}. Approval is required before it becomes available.</p>`;
      renderCampaigns(await api("/campaigns/"));
    } catch (error) { showMessage(error.message); }
  };
});

function startTaskTimer(card, taskId, startedAt) {
  const claimButton = card.querySelector(`[data-claim-task="${taskId}"]`);
  const wait = card.querySelector(`[data-task-wait="${taskId}"]`);
  const canClaimAt = Date.parse(startedAt) + Number(card.dataset.taskSeconds) * 1000;
  claimButton.disabled = true;
  const updateWait = () => {
    const remaining = Math.max(0, Math.ceil((canClaimAt - Date.now()) / 1000));
    wait.textContent = remaining ? `Keep the content open; you can claim this task in ${remaining} seconds.` : "Viewing time reached. Claim the task to answer its question.";
    if (!remaining) {
      claimButton.disabled = false;
      clearInterval(timer);
    }
  };
  const timer = setInterval(updateWait, 1000);
  updateWait();
}

$("#tasksBtn").addEventListener("click", async () => {
  try {
    const [tasksData, claims] = await Promise.all([api("/tasks/"), api("/my-claims/")]);
    const tasks = Array.isArray(tasksData) ? tasksData : tasksData.results || [];
    const claimsByTask = new Map(claims.map((claim) => [claim.task, claim]));
    $("#actionArea").innerHTML = tasks.length ? tasks.map((task) => `<div class="inline-form" data-task-seconds="${Number(task.seconds)}"><b>${esc(task.campaign_title || "Campaign task")}</b><p class="muted">${esc(task.platform)} ${esc(task.content_type)} · ${esc(task.objective)} · viewing time ${Number(task.seconds)}s</p><button class="button" data-open-task="${task.id}" data-url="${esc(task.campaign_url)}">Open content &amp; start timer</button><p class="muted" data-task-wait="${task.id}" aria-live="polite">Open the content to start the viewing timer.</p><button class="outline" data-claim-task="${task.id}" disabled>Claim task</button><p class="muted" data-task-question="${task.id}"></p><label>Your answer<input id="answer-${task.id}" disabled placeholder="Answer the question shown after claiming"></label><button class="outline" data-answer="${task.id}" disabled>Submit answer for verification</button></div>`).join("") : "<p class='muted'>No approved tasks are available at the moment.</p>";
    $("#actionArea").querySelectorAll("[data-open-task]").forEach((button) => {
      const card = button.closest(".inline-form");
      const wait = card.querySelector(`[data-task-wait="${button.dataset.openTask}"]`);
      const question = card.querySelector(`[data-task-question="${button.dataset.openTask}"]`);
      const claimButton = card.querySelector(`[data-claim-task="${button.dataset.openTask}"]`);
      const answer = $(`#answer-${button.dataset.openTask}`);
      const answerButton = card.querySelector(`[data-answer="${button.dataset.openTask}"]`);
      const claim = claimsByTask.get(Number(button.dataset.openTask));
      if (claim?.status === "STARTED") {
        button.textContent = "Reopen content";
        startTaskTimer(card, button.dataset.openTask, claim.started_at);
      } else if (claim?.status === "CLAIMED") {
        button.disabled = true;
        button.textContent = "Viewing time complete";
        claimButton.disabled = true;
        claimButton.textContent = "Task claimed";
        question.textContent = claim.question || "No question is configured for this task.";
        answer.disabled = false;
        answerButton.disabled = false;
        wait.textContent = "Answer the question and submit it for admin verification.";
      } else if (claim) {
        button.disabled = true;
        claimButton.disabled = true;
        button.textContent = `Task ${claim.status.toLowerCase()}`;
        question.textContent = claim.question || "";
        wait.textContent = claim.status === "SUBMITTED"
          ? "Answer submitted and awaiting admin verification."
          : claim.status === "APPROVED"
            ? "Task approved. Your level earning has been credited."
            : "Task rejected. Contact an admin if you need help.";
      }
      button.onclick = async () => {
        const contentWindow = window.open(button.dataset.url, "_blank");
        if (contentWindow) contentWindow.opener = null;
        if (!contentWindow) {
          showMessage("Your browser blocked the campaign tab. Allow pop-ups to open the campaign.");
          return;
        }
        try {
          if (!claimsByTask.has(Number(button.dataset.openTask))) {
            const result = await api(`/tasks/${button.dataset.openTask}/start/`, {method: "POST", body: JSON.stringify({})});
            claimsByTask.set(Number(button.dataset.openTask), result);
            button.textContent = "Reopen content";
            wait.textContent = "Viewing timer started.";
            startTaskTimer(card, button.dataset.openTask, result.started_at);
          }
        } catch (error) {
          if (contentWindow) contentWindow.close();
          showMessage(error.message);
        }
      };
      claimButton.onclick = async () => {
        try {
          const result = await api(`/tasks/${claimButton.dataset.claimTask}/claim/`, {method: "POST", body: JSON.stringify({})});
          claimsByTask.set(Number(claimButton.dataset.claimTask), result);
          claimButton.disabled = true;
          claimButton.textContent = "Task claimed";
          question.textContent = result.question || "No question is configured for this task.";
          answer.disabled = false;
          answerButton.disabled = false;
          wait.textContent = "Answer the question and submit it for admin verification.";
        } catch (error) { showMessage(error.message); }
      };
    });
    $("#actionArea").querySelectorAll("[data-answer]").forEach((button) => {
      button.onclick = async () => {
        try {
          const answer = $(`#answer-${button.dataset.answer}`);
          await api(`/tasks/${button.dataset.answer}/answer/`, {method: "POST", body: JSON.stringify({answer: answer.value})});
          answer.disabled = true;
          button.disabled = true;
          button.textContent = "Answer submitted";
          button.closest(".inline-form").querySelector(`[data-task-wait="${button.dataset.answer}"]`).textContent = "Answer submitted for evaluation.";
        } catch (error) { showMessage(error.message); }
      };
    });
  } catch (error) { showMessage(`${error.message} You may need an active engager account.`); }
});

$("#withdrawBtn").addEventListener("click", async () => {
  try {
    const settings = await api("/settings/");
    actionForm(`<b>Request withdrawal</b><p class="muted">Configured minimum: ${money(settings.withdrawal_threshold)}. Requests are manually reviewed.</p><label>Amount (KSh)<input id="wAmount" type="number" min="${settings.withdrawal_threshold}" step=".01" required></label><label>M-Pesa number<input id="wPhone" required placeholder="2547xx xxx xxx"></label><button class="button" id="sendWithdrawal">Submit request</button>`);
    $("#sendWithdrawal").onclick = async () => {
      try {
        await api("/withdrawals/", {method: "POST", body: JSON.stringify({amount: $("#wAmount").value, mpesa_number: $("#wPhone").value})});
        $("#actionArea").innerHTML = "<p class='message'>Withdrawal request submitted for admin approval.</p>";
        await refreshUser();
      } catch (error) { showMessage(error.message); }
    };
  } catch (error) { showMessage(error.message); }
});

loadDashboard();
