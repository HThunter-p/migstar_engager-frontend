const API = "http://127.0.0.1:8000/api";
const accessToken = localStorage.getItem("me_access") || "";
const $ = (s) => document.querySelector(s);
function headers(json=true){const h={};if(json)h["Content-Type"]="application/json";return h}
async function api(path, options={}) {
  const response = await fetch(API+path,{...options,headers:{...headers(options.body!==undefined),...(options.headers||{})}});
  let data={};try{data=await response.json()}catch{}
  if(!response.ok){const fieldErrors=Object.values(data).flatMap(v=>Array.isArray(v)?v:[v]).filter(v=>typeof v==="string");throw new Error(typeof data.detail==="string"?data.detail:fieldErrors.join(" ")||response.statusText||"Request failed")}
  return data;
}
function setMessage(text){$("#authMessage").textContent=text}
if(accessToken){window.location.replace("dashboard.html")}
else {
  const notice=new URLSearchParams(window.location.search).get("notice");
  if(notice){setMessage(notice);showForm("login")}
}
function showForm(kind){
  $("#registerForm").hidden=kind!=="register";$("#loginForm").hidden=kind!=="login";
  document.querySelectorAll(".tab").forEach(b=>b.classList.toggle("active",b.dataset.tab===kind));
}
document.querySelectorAll(".tab").forEach(b=>b.addEventListener("click",()=>showForm(b.dataset.tab)));
$("#getStartedCta").addEventListener("click",()=>showForm("register"));
$("#signInCta").addEventListener("click",()=>showForm("login"));
$("#registerFirstBtn").addEventListener("click",()=>showForm("register"));
$("#registerForm").addEventListener("submit",async e=>{
  e.preventDefault();const f=new FormData(e.currentTarget);const roles=f.getAll("roles");
  if(!roles.length){setMessage("Choose Creator, Engager, or both.");return}
  const payload={username:f.get("username"),email:f.get("email"),phone:f.get("phone"),mpesa_number:f.get("mpesa_number"),password:f.get("password"),roles,referral_code_input:f.get("referral_code_input")};
  try{await api("/auth/register/",{method:"POST",body:JSON.stringify(payload)});setMessage("Account created. Please sign in; activation requires approval.");showForm("login");$("#loginForm [name=username]").value=payload.username}
  catch(err){setMessage(err.message)}
});
$("#loginForm").addEventListener("submit",async e=>{
  e.preventDefault();const f=new FormData(e.currentTarget);
  try{const d=await api("/auth/token/",{method:"POST",body:JSON.stringify({username:f.get("username"),password:f.get("password")})});localStorage.setItem("me_access",d.access);localStorage.setItem("me_refresh",d.refresh);window.location.assign("dashboard.html")}
  catch(err){setMessage(err.message)}
});
async function loadLevels(){
  try{const levels=await api("/levels/");$("#levelCount").textContent=levels.length;
    $("#levelList").innerHTML=levels.map(l=>`<article class="level-card"><span class="pill">DEMO LEVEL</span><h3>${esc(l.name)}</h3><div class="price">${money(l.fee)} <small>/ one-time</small></div><p>${esc(l.description||"Admin-configured access level.")}</p><div class="sample">Sample daily: <b>${money(l.sample_daily_earning)}</b><br>30 days: ${money(l.sample_30_day_earning)} · 60 days: ${money(l.sample_60_day_earning)}</div></article>`).join("")||"<p>No active levels yet.</p>";
  }catch(e){$("#levelList").innerHTML=`<p class="muted">Could not load levels. Start the Django backend. ${esc(e.message)}</p>`}
}
async function loadActivationFee(){
  try{
    const settings=await api("/settings/");
    $("#activationFeeNote").textContent=`Creator initial activation fee: ${money(settings.creator_activation_fee)}. This includes ${settings.free_campaign_slots} free campaign trials; campaign fees apply after those trials. Payment instructions are provided after requesting activation.`;
  }catch(error){
    $("#activationFeeNote").textContent=`Could not load the current creator activation fee: ${esc(error.message)}`;
  }
}
function esc(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function money(n){return "KSh "+Number(n||0).toLocaleString("en-KE",{maximumFractionDigits:2})}
if(!accessToken){loadLevels();loadActivationFee()}
