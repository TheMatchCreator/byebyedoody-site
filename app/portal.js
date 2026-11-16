/* ByeByeDoody staged portal client.
   Authentication adapter contract: window.BBDOODY_AUTH.getAccessToken()
   must be supplied by the selected managed OIDC SDK. No tokens are persisted here. */
(() => {
  "use strict";
  const root = document.getElementById("portal-app");
  if (!root) return;
  const state = { role: "customer", token: null, requests: [], quotes: [], availability: [], areas: [], message: "" };
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[char]));
  const money = (cents) => new Intl.NumberFormat("en-US", { style:"currency", currency:"USD" }).format((Number(cents)||0)/100);
  async function api(path, options = {}) {
    const auth = window.BBDOODY_AUTH;
    if (!auth || typeof auth.getAccessToken !== "function") throw new Error("Secure sign-in has not been connected yet. Your account and private data remain protected.");
    const token = await auth.getAccessToken();
    if (!token) throw new Error("Please sign in to continue.");
    const response = await fetch(path, {
      ...options,
      headers: { "Accept":"application/json", ...(options.body ? {"Content-Type":"application/json"} : {}), "Authorization":"Bearer "+token, ...(options.headers||{}) },
      cache: "no-store"
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "The request could not be completed.");
    return data;
  }
  function notice(message, error = false) {
    const el = root.querySelector("[data-notice]");
    if (el) { el.textContent = message; el.className = "portal-notice" + (error ? " is-error" : ""); el.hidden = false; }
  }
  function shell() {
    root.innerHTML = `
      <div class="portal-shell">
        <aside class="portal-sidebar">
          <p class="eyebrow">ACCOUNT WORKSPACE</p><h2>ByeByeDoody</h2>
          <label for="portal-role">Workspace</label>
          <select id="portal-role"><option value="customer">Customer</option><option value="provider">Independent provider</option><option value="admin">Administrator</option></select>
          <nav aria-label="Portal sections" class="portal-nav">
            <button type="button" data-view="home" class="is-active">Overview</button>
            <button type="button" data-view="requests">Service requests</button>
            <button type="button" data-view="quotes">Quotes</button>
            <button type="button" data-view="provider">Provider tools</button>
            <button type="button" data-view="privacy">Privacy & support</button>
            <button type="button" data-view="admin">Administration</button>
          </nav>
          <p class="portal-sidebar-note">Private workspace preview. Secure sign-in must be connected before data access is enabled.</p>
        </aside>
        <section class="portal-main">
          <div class="portal-top"><div><p class="eyebrow">YOUR BYEBYEDOODY WORKSPACE</p><h1 id="portal-title">Overview</h1></div><a class="button button-outline-dark" href="/marketplace/">Marketplace</a></div>
          <div class="portal-notice" data-notice role="status" hidden></div>
          <div id="portal-view"></div>
        </section>
      </div>`;
    root.querySelector("#portal-role").addEventListener("change", (event) => { state.role = event.target.value; render("home"); });
    root.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => render(button.dataset.view)));
    render("home");
  }
  function render(view) {
    root.querySelectorAll("[data-view]").forEach((b) => b.classList.toggle("is-active", b.dataset.view === view));
    const title = root.querySelector("#portal-title");
    const pane = root.querySelector("#portal-view");
    const views = {
      home: () => `
        <div class="portal-grid">
          <article class="portal-panel portal-wide"><p class="market-kicker">MARKETPLACE STATUS</p><h2>Secure account access is not connected</h2><p>The portal screens are prepared, but customer records, provider tools and administrator actions remain locked until the managed sign-in service and Cloudflare D1 database are configured.</p><div class="portal-actions"><a class="button button-dark" href="/marketplace/customer-request.html">Send a service inquiry</a><a class="button button-outline-dark" href="/work-with-us.html">Provider information</a></div></article>
          <article class="portal-panel"><h3>Customer workspace</h3><p>View your requests and compare independent provider quotes after secure sign-in is enabled.</p><button type="button" class="button button-outline-dark" data-go="requests">View requests</button></article>
          <article class="portal-panel"><h3>Provider workspace</h3><p>Manage opt-in service ZIP codes, availability and independent quotes after approval.</p><button type="button" class="button button-outline-dark" data-go="provider">Provider tools</button></article>
          <article class="portal-panel"><h3>Privacy and support</h3><p>Submit a privacy request or report an issue associated with an active referral.</p><button type="button" class="button button-outline-dark" data-go="privacy">Open privacy tools</button></article>
        </div>
        <article class="portal-panel portal-warning"><strong>Not a live booking system</strong><p>No bookings, automatic dispatch, customer charges or provider payouts are enabled.</p></article>`,
      requests: () => `
        <article class="portal-panel"><h2>Service requests</h2><p>Customer accounts can view their own requests. New marketplace requests require secure account sign-in.</p><button class="button button-dark" type="button" data-action="load-requests">Load my requests</button><div data-results class="portal-results"></div></article>`,
      quotes: () => `
        <article class="portal-panel"><h2>Provider quotes</h2><p>Providers submit their own rates. Customers can review quotes linked to their requests. This screen does not accept a quote or create a booking.</p><button class="button button-dark" type="button" data-action="load-quotes">Load my quotes</button><div data-results class="portal-results"></div></article>`,
      provider: () => `
        <div class="portal-grid">
          <article class="portal-panel portal-wide"><h2>Independent provider application</h2><p>Complete this application only if you operate your own independent business. Submission does not guarantee approval or work referrals. Required statements must reflect your real business practices.</p><form data-form="provider-application"><label>Independent business name<input name="businessName" required minlength="2" maxlength="120"></label><label>Service ZIP codes (comma-separated)<input name="zipCodes" placeholder="95823, 95824" required></label><label class="portal-check"><input type="checkbox" name="businessRegistration" required> I maintain the business registration required for my services.</label><label class="portal-check"><input type="checkbox" name="ownTools" required> I supply and maintain my own tools and equipment.</label><label class="portal-check"><input type="checkbox" name="independentClients" required> I am free to serve other customers and maintain independent clients.</label><label class="portal-check"><input type="checkbox" name="setsRates" required> I independently set or negotiate my own service rates.</label><label class="portal-check"><input type="checkbox" name="setsHours" required> I choose my own working hours and availability.</label><label class="portal-check"><input type="checkbox" name="freeChoice" required> I may freely accept or reject each referral without penalty.</label><button class="button button-dark">Submit provider application</button></form></article>
          <article class="portal-panel"><h2>Service ZIP codes</h2><p>Approved providers can choose up to 20 service ZIP codes.</p><form data-form="area"><label>Five-digit ZIP code<input name="zip" inputmode="numeric" pattern="[0-9]{5}" maxlength="5" required></label><button class="button button-dark">Add ZIP code</button></form><button type="button" class="button button-outline-dark" data-action="load-areas">Load my ZIP codes</button><div data-areas class="portal-results"></div></article>
          <article class="portal-panel"><h2>Availability</h2><p>Choose future UTC times. You may withdraw a window at any time; adding availability does not commit you to a referral.</p><form data-form="availability"><label>Starts (UTC)<input name="startsAt" type="datetime-local" required></label><label>Ends (UTC)<input name="endsAt" type="datetime-local" required></label><button class="button button-dark">Add availability</button></form><button type="button" class="button button-outline-dark" data-action="load-availability">Load availability</button><div data-availability class="portal-results"></div></article>
        </div>`,
      privacy: () => `
        <div class="portal-grid">
          <article class="portal-panel"><h2>Privacy request</h2><p>Submit an access, correction, deletion or location-revocation request. Identity checks and lawful retention requirements may apply.</p><form data-form="privacy"><label>Request type<select name="requestType" required><option value="access">Access my information</option><option value="correction">Correct my information</option><option value="deletion">Delete my information</option><option value="location_revocation">Revoke location consent</option></select></label><button class="button button-dark">Submit privacy request</button></form><button class="button button-outline-dark" type="button" data-action="load-privacy">View my privacy requests</button><div data-privacy class="portal-results"></div></article>
          <article class="portal-panel"><h2>Report a service issue</h2><p>Available to customers and providers connected to a referral.</p><form data-form="issue"><label>Referral ID<input name="referralId" required maxlength="80"></label><label>Issue type<select name="issueType"><option value="service_quality">Service quality</option><option value="property_access">Property access</option><option value="animal_safety">Animal safety</option><option value="payment">Payment</option><option value="late_or_missed">Late or missed service</option><option value="other">Other</option></select></label><label>Details<textarea name="description" required minlength="10" maxlength="2000"></textarea></label><button class="button button-dark">Submit issue</button></form></article>
        </div>`,
      admin: () => `
        <div class="portal-grid">
          <article class="portal-panel"><h2>Operations overview</h2><p>Restricted to active administrator accounts.</p><button type="button" class="button button-dark" data-action="admin-overview">Load queue counts</button><div data-results class="portal-results"></div></article>
          <article class="portal-panel"><h2>Provider applications</h2><p>Review submitted applications. Approval requires verified email and all independence attestations.</p><button type="button" class="button button-dark" data-action="admin-providers">Load applications</button><div data-providers class="portal-results"></div></article>
          <article class="portal-panel"><h2>Referral suggestions</h2><p>ZIP and provider-opted availability suggestions only. Human review is required; no automatic dispatch.</p><button type="button" class="button button-outline-dark" data-action="admin-matches">Calculate suggestions</button><div data-matches class="portal-results"></div></article>
        </div>`
    };
    title.textContent = ({home:"Overview",requests:"Service requests",quotes:"Quotes",provider:"Provider tools",privacy:"Privacy & support",admin:"Administration"})[view] || "Overview";
    pane.innerHTML = (views[view] || views.home)();
    pane.querySelectorAll("[data-go]").forEach((button) => button.addEventListener("click", () => render(button.dataset.go)));
    pane.querySelectorAll("form").forEach((form) => form.addEventListener("submit", (event) => submitForm(event, form)));
    pane.querySelectorAll("[data-action]").forEach((button) => button.addEventListener("click", () => runAction(button.dataset.action, button)));
  }
  function formObject(form) { return Object.fromEntries(new FormData(form).entries()); }
  async function submitForm(event, form) {
    event.preventDefault();
    const data = formObject(form);
    try {
      if (form.dataset.form === "area") {
        const result = await api("/api/marketplace/service-areas", { method:"POST", body:JSON.stringify(data) });
        notice("ZIP code "+result.zip+" added to your service area.");
      } else if (form.dataset.form === "provider-application") {\n        const zipCodes = data.zipCodes.split(/[ ,;]+/).filter(Boolean);\n        const attestations = {businessRegistration:form.elements.businessRegistration.checked,ownTools:form.elements.ownTools.checked,independentClients:form.elements.independentClients.checked,setsRates:form.elements.setsRates.checked,setsHours:form.elements.setsHours.checked,freeChoice:form.elements.freeChoice.checked};\n        const result = await api("/api/marketplace/provider-application", { method:"POST", body:JSON.stringify({businessName:data.businessName,zipCodes,attestations}) });\n        notice("Provider application submitted: "+result.status+". It is awaiting review.");\n      } else if (form.dataset.form === "availability") {
        const toIso = (value) => new Date(value + ":00Z").toISOString();
        const result = await api("/api/marketplace/availability", { method:"POST", body:JSON.stringify({startsAt:toIso(data.startsAt),endsAt:toIso(data.endsAt),status:"available"}) });
        notice("Availability window saved. You remain free to accept or decline any referral.");
      } else if (form.dataset.form === "privacy") {
        const result = await api("/api/marketplace/privacy-requests", { method:"POST", body:JSON.stringify(data) });
        notice("Privacy request recorded: "+result.requestId);
      } else if (form.dataset.form === "issue") {
        const result = await api("/api/marketplace/issues", { method:"POST", body:JSON.stringify(data) });
        notice("Issue recorded: "+result.issueId);
      }
      form.reset();
    } catch (error) { notice(error.message, true); }
  }
  async function runAction(action, button) {
    const panel = button.closest(".portal-panel");
    const target = panel?.querySelector("[data-results],[data-areas],[data-availability],[data-privacy],[data-providers],[data-matches]");
    if (target) target.textContent = "Loading…";
    const renderRows = (rows, fields) => rows.length ? rows.map((row) => "<div class='portal-result-row'>"+fields.map(([key,label])=>"<span><b>"+escapeHtml(label)+":</b> "+escapeHtml(row[key] ?? "—")+"</span>").join("")+"</div>").join("") : "<p>No records found.</p>";
    try {
      let data, html = "";
      if (action === "load-requests") { data=await api("/api/marketplace/requests"); html=renderRows(data.requests||[],[["service_zip","ZIP"],["service_type","Frequency"],["status","Status"],["created_at","Submitted"]]); }
      if (action === "load-quotes") { data=await api("/api/marketplace/quotes"); html=renderRows(data.quotes||[],[["provider_service_rate_cents","Provider rate (cents)"],["status","Status"],["created_at","Submitted"]]); }
      if (action === "load-areas") { data=await api("/api/marketplace/service-areas"); html=renderRows(data.serviceAreas||[],[["zip_code","ZIP"],["active","Active"]]); }
      if (action === "load-availability") { data=await api("/api/marketplace/availability"); html=renderRows(data.availability||[],[["starts_at","Starts"],["ends_at","Ends"],["status","Status"]]); }
      if (action === "load-privacy") { data=await api("/api/marketplace/privacy-requests"); html=renderRows(data.privacyRequests||[],[["request_type","Type"],["status","Status"],["received_at","Received"]]); }
      if (action === "admin-overview") { data=await api("/api/marketplace/admin-overview"); html=["requests","providers","quotes","serviceIssues","privacyRequests"].map((key)=>"<h3>"+escapeHtml(key)+"</h3>"+renderRows(data[key]||[],[["status","Status"],["count","Count"]])).join(""); }
      if (action === "admin-providers") { data=await api("/api/marketplace/admin-providers"); html=(data.providers||[]).map((p)=>"<div class='portal-result-row'><b>"+escapeHtml(p.independent_business_name)+"</b><span>Status: "+escapeHtml(p.onboarding_status)+"</span><span>Provider ID: "+escapeHtml(p.user_id)+"</span><div class='portal-actions'><button type='button' data-review='approve' data-id='"+escapeHtml(p.user_id)+"'>Approve</button><button type='button' data-review='reject' data-id='"+escapeHtml(p.user_id)+"'>Reject</button><button type='button' data-review='request_changes' data-id='"+escapeHtml(p.user_id)+"'>Request changes</button></div></div>").join("")||"<p>No applications.</p>"; }
      if (action === "admin-matches") { data=await api("/api/marketplace/admin-matches"); html=(data.matches||[]).map((m)=>"<div class='portal-result-row'><b>Request "+escapeHtml(m.request.id)+" · ZIP "+escapeHtml(m.request.zip)+"</b>"+renderRows(m.candidates,[["businessName","Provider"],["nextAvailableStart","Available from"]])+"</div>").join("")||"<p>No suggestions.</p>"; }
      if (target) target.innerHTML=html;
      panel?.querySelectorAll("[data-review]").forEach((control)=>control.addEventListener("click",async()=>{
        try { const result=await api("/api/marketplace/admin-providers",{method:"POST",body:JSON.stringify({providerId:control.dataset.id,decision:control.dataset.review})}); notice("Provider application updated: "+result.status); await runAction("admin-providers",button); }
        catch(error){notice(error.message,true);}
      }));
      if (action==="load-areas" && target) target.querySelectorAll(".portal-result-row").forEach((row,i)=>{const zip=(data.serviceAreas||[])[i]?.zip_code;if(zip){const b=document.createElement("button");b.type="button";b.textContent="Remove";b.addEventListener("click",async()=>{try{await api("/api/marketplace/service-areas",{method:"DELETE",body:JSON.stringify({zip})});notice("ZIP removed.");await runAction(action,button);}catch(e){notice(e.message,true);}});row.appendChild(b);}});
      if (action==="load-availability" && target) target.querySelectorAll(".portal-result-row").forEach((row,i)=>{const id=(data.availability||[])[i]?.id;if(id){const b=document.createElement("button");b.type="button";b.textContent="Withdraw";b.addEventListener("click",async()=>{try{await api("/api/marketplace/availability",{method:"DELETE",body:JSON.stringify({id})});notice("Availability withdrawn.");await runAction(action,button);}catch(e){notice(e.message,true);}});row.appendChild(b);}});
    } catch (error) { if (target) target.textContent=error.message; notice(error.message,true); }
  }
  shell();
})();