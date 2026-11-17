#!/usr/bin/env python3
"""Builds /areas/*.html local service pages, /areas/index.html, sitemap.xml and robots.txt.
Re-run after editing AREAS. Prices are customer totals including ByeByeDoody's 20% platform fee."""
import json, html, datetime, pathlib
ROOT = pathlib.Path(__file__).resolve().parent.parent
SITE = "https://www.byebyedoody.com"
AREAS = [
  ("sacramento", "Sacramento", ["95811","95814","95816","95817","95818","95819","95820","95822","95823","95824","95826","95828","95831","95833","95834","95835","95838"], "From Midtown and East Sacramento to Land Park, South Sac and Natomas"),
  ("elk-grove", "Elk Grove", ["95624","95757","95758"], "From Laguna to East Franklin and Old Town Elk Grove"),
  ("roseville", "Roseville", ["95661","95678","95747"], "Across Roseville neighborhoods east and west of Highway 65"),
  ("folsom", "Folsom", ["95630"], "Across Folsom, from the Historic District to Empire Ranch"),
  ("citrus-heights", "Citrus Heights", ["95610","95621"], "Throughout Citrus Heights"),
  ("rancho-cordova", "Rancho Cordova", ["95670","95742"], "Throughout Rancho Cordova, including Anatolia and Capital Village"),
  ("west-sacramento", "West Sacramento", ["95605","95691"], "Throughout West Sacramento, including Southport and the Bridge District"),
  ("carmichael", "Carmichael", ["95608"], "Throughout Carmichael"),
  ("fair-oaks", "Fair Oaks", ["95628"], "Throughout Fair Oaks"),
  ("arden-arcade", "Arden-Arcade", ["95821","95825","95864"], "Across Arden-Arcade, Arden Park and Sierra Oaks"),
  ("natomas", "Natomas", ["95833","95834","95835"], "Across North and South Natomas"),
  ("antelope", "Antelope", ["95843"], "Throughout Antelope"),
  ("north-highlands", "North Highlands", ["95660"], "Throughout North Highlands"),
  ("orangevale", "Orangevale", ["95662"], "Throughout Orangevale"),
  ("rocklin", "Rocklin", ["95677","95765"], "Throughout Rocklin, including Whitney Ranch"),
  ("davis", "Davis", ["95616","95618"], "Throughout Davis"),
]
def money(c): return f"${c/100:,.0f}"
def total(rate_dollars): return -(-rate_dollars*10000//8000)  # cents ceil of rate/0.8 in cents
ONE = (total(3600), total(6900))      # one-time, 1-3 dogs, small-large yard (customer total)
WEEK = (total(1400), total(3200))     # weekly per visit
HEAD = '''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="{desc}"><title>{title}</title><link rel="canonical" href="{url}"><link rel="stylesheet" href="/styles.css"><script defer src="/site.js"></script>{ld}</head><body>
<header class="site-header"><a class="brand" href="/"><span class="brand-mark">B</span><span>ByeBye<span class="brand-accent">Doody</span><small>Yard cleanup made easy</small></span></a><button class="menu-toggle" aria-label="Open menu" aria-expanded="false">☰</button><nav class="nav"><a href="/services.html">Services</a><a href="/areas/">Service areas</a><a href="/work-with-us.html">Work with us</a><a class="nav-cta" href="/app/">Book a cleanup</a></nav></header>
<main>'''
FOOT = '''</main>
<footer class="footer"><a class="brand brand-footer" href="/"><span class="brand-mark">B</span><span>ByeBye<span class="brand-accent">Doody</span><small>Yard cleanup made easy</small></span></a><div class="footer-links"><a href="/services.html">Services</a><a href="/areas/">Service areas</a><a href="/work-with-us.html">Work with us</a><a href="/contact.html">Contact</a><a href="/privacy.html">Privacy</a></div><p>© <span data-year></span> ByeByeDoody. All rights reserved.</p></footer><script defer src="/assistant.js?v=1"></script></body></html>
'''
def page(slug, city, zips, where):
    url = f"{SITE}/areas/{slug}"  # Cloudflare Pages serves pages without .html
    faq = [
      (f"How much does dog poop cleanup cost in {city}?", f"Independent providers set their own prices. Typical totals in the Sacramento area are about {money(ONE[0])}–{money(ONE[1])} for a one-time cleanup and {money(WEEK[0])}–{money(WEEK[1])} per visit for weekly service, depending on yard size and number of dogs. The total you pay includes ByeByeDoody's platform fee (20% of the total), shown before you pay."),
      (f"How fast can I get a cleanup in {city}?", "As soon as you post a request, approved providers who serve your ZIP code get an instant alert and can send you quotes. You choose the quote you like."),
      ("Do I need to be home?", "Usually not, as long as the provider can safely reach the yard and pets are secured. Add gate codes or pet notes in your request; they are encrypted and only shown to the provider after you pay for that job."),
      (f"How can I find dog-waste cleanup work in {city}?", f"Independent cleanup businesses can apply in the ByeByeDoody account portal, add {city} ZIP codes ({', '.join(zips[:4])}{'…' if len(zips)>4 else ''}) and turn on instant job alerts. You set your own prices and choose which jobs to take."),
    ]
    ld = json.dumps({"@context":"https://schema.org","@graph":[
      {"@type":"Service","name":f"Dog poop yard cleanup in {city}, CA","serviceType":"Dog waste removal","areaServed":{"@type":"City","name":f"{city}, CA"},"provider":{"@type":"Organization","name":"ByeByeDoody","url":SITE},"url":url},
      {"@type":"FAQPage","mainEntity":[{"@type":"Question","name":q,"acceptedAnswer":{"@type":"Answer","text":a}} for q,a in faq]}]})
    e = html.escape
    body = f'''
<section class="page-hero"><p class="eyebrow">{e(city.upper())}, CALIFORNIA</p><h1>Dog poop cleanup in {e(city)}</h1><p>Get a clean yard from independent local cleanup pros. Post your request in two minutes, compare quotes, and pay securely online.</p><div class="button-row" style="justify-content:center"><a class="button button-dark" href="/app/">Get quotes now</a><a class="button button-outline-dark" style="border:1px solid #8da99b" href="#providers">Find cleanup work</a></div></section>
<section class="section"><div class="narrow">
<h2>How it works in {e(city)}</h2>
<div class="steps"><article><span>01</span><h3>Post your yard</h3><p>Tell us your ZIP code, number of dogs, yard size and how often. Not sure of the price? Tap “Estimate my price” for an AI estimate.</p></article><article><span>02</span><h3>Get quotes fast</h3><p>Approved providers serving your ZIP get an instant alert and send their own quotes.</p></article><article><span>03</span><h3>Pay and track</h3><p>Pay through Stripe once a provider accepts. On cleanup day, see when your provider is on the way.</p></article></div>
<h2>Areas we cover</h2><p>{e(where)}. ZIP codes: {e(", ".join(zips))}. Don't see yours? Post a request anyway — providers expand their areas as demand grows.</p>
<h2>Typical prices</h2><p>One-time cleanup: about {money(ONE[0])}–{money(ONE[1])}. Weekly service: about {money(WEEK[0])}–{money(WEEK[1])} per visit. Each provider sets their own price; totals include ByeByeDoody's platform fee (20% of the total), always shown before you pay.</p>
<h2 id="providers">Get dog-waste cleanup jobs in {e(city)}</h2><p>Run your own cleanup business? Apply in the <a class="text-link" href="/app/">account portal</a>, add your {e(city)} ZIP codes, and turn on instant job alerts. Use the AI price helper to quote fast. You keep your full quoted rate, set your own hours, and take only the jobs you want. Payouts go straight to your bank through Stripe.</p>
<h2>Questions</h2>{"".join(f"<h3>{e(q)}</h3><p>{e(a)}</p>" for q,a in faq)}
<p><a class="button button-dark" href="/app/">Book a cleanup in {e(city)}</a></p>
</div></section>'''
    return HEAD.format(desc=e(f"Dog poop cleanup in {city}, CA. Get quotes from independent local providers fast, pay securely online, and track your cleanup. Cleanup pros: find jobs in {city}."), title=e(f"Dog Poop Cleanup in {city}, CA | ByeByeDoody"), url=url, ld=f'<script type="application/ld+json">{ld}</script>') + body + FOOT
(ROOT/"areas").mkdir(exist_ok=True)
for a in AREAS: (ROOT/"areas"/f"{a[0]}.html").write_text(page(*a))
links = "".join(f'<li><a class="text-link" href="/areas/{s}.html">{html.escape(c)}</a> <span class="fineprint">({", ".join(z[:3])}{"…" if len(z)>3 else ""})</span></li>' for s,c,z,_ in AREAS)
(ROOT/"areas"/"index.html").write_text(HEAD.format(desc="ByeByeDoody dog poop cleanup service areas around Sacramento, California.", title="Service Areas | ByeByeDoody", url=f"{SITE}/areas/", ld="") + f'''
<section class="page-hero"><p class="eyebrow">SERVICE AREAS</p><h1>Dog poop cleanup around Sacramento</h1><p>Pick your city to see prices and how it works, or just <a class="text-link" href="/app/">post a request</a>.</p></section>
<section class="section"><div class="narrow"><ul class="check-list">{links}</ul></div></section>''' + FOOT)
pages = ["/", "/services", "/quote", "/work-with-us", "/partners", "/contact", "/privacy", "/marketplace/", "/app/customer-guide", "/app/provider-guide", "/areas/"] + [f"/areas/{a[0]}" for a in AREAS]
today = datetime.date.today().isoformat()
(ROOT/"sitemap.xml").write_text('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + "".join(f"  <url><loc>{SITE}{p}</loc><lastmod>{today}</lastmod></url>\n" for p in pages) + "</urlset>\n")
(ROOT/"robots.txt").write_text(f"User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /app/index.html\n\nSitemap: {SITE}/sitemap.xml\n")
print(len(AREAS), "area pages")
