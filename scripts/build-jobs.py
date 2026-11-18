#!/usr/bin/env python3
"""Build /jobs/ recruiting pages (Google for Jobs JobPosting markup) for each launch city.

Run from the repo root:  python3 scripts/build-jobs.py
Edit CITIES to add a city, then re-run. Pages are rewritten every run.
"""
import html
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE = "https://www.byebyedoody.com"
DATE_POSTED = "2026-11-17"
VALID_THROUGH = "2027-02-15T23:59:00"
APPLY = "/app/?join=provider"

# slug, city, state abbr, state name, downtown ZIP, nearby communities
CITIES = [
    ("new-york", "New York", "NY", "New York", "10001", ["Brooklyn", "Queens", "the Bronx", "Staten Island", "Long Island", "Westchester"]),
    ("los-angeles", "Los Angeles", "CA", "California", "90012", ["Long Beach", "Glendale", "Pasadena", "Burbank", "Torrance", "Santa Clarita"]),
    ("chicago", "Chicago", "IL", "Illinois", "60601", ["Naperville", "Aurora", "Joliet", "Evanston", "Schaumburg", "Elgin"]),
    ("dallas", "Dallas", "TX", "Texas", "75201", ["Fort Worth", "Arlington", "Plano", "Irving", "Frisco", "McKinney"]),
    ("houston", "Houston", "TX", "Texas", "77002", ["Katy", "Sugar Land", "The Woodlands", "Pearland", "League City", "Cypress"]),
    ("washington-dc", "Washington", "DC", "District of Columbia", "20001", ["Arlington", "Alexandria", "Silver Spring", "Bethesda", "Fairfax", "Rockville"]),
    ("philadelphia", "Philadelphia", "PA", "Pennsylvania", "19103", ["Cherry Hill", "Camden", "King of Prussia", "Norristown", "Media", "Wilmington"]),
    ("atlanta", "Atlanta", "GA", "Georgia", "30303", ["Marietta", "Alpharetta", "Sandy Springs", "Roswell", "Decatur", "Smyrna"]),
    ("miami", "Miami", "FL", "Florida", "33130", ["Fort Lauderdale", "Hialeah", "Hollywood", "Pembroke Pines", "Coral Springs", "West Palm Beach"]),
    ("phoenix", "Phoenix", "AZ", "Arizona", "85004", ["Mesa", "Chandler", "Scottsdale", "Gilbert", "Glendale", "Tempe"]),
    ("boston", "Boston", "MA", "Massachusetts", "02108", ["Cambridge", "Quincy", "Newton", "Somerville", "Lowell", "Brockton"]),
    ("riverside", "Riverside", "CA", "California", "92501", ["San Bernardino", "Fontana", "Moreno Valley", "Corona", "Ontario", "Temecula"]),
    ("san-francisco", "San Francisco", "CA", "California", "94103", ["Oakland", "Berkeley", "Fremont", "Hayward", "Daly City", "San Mateo"]),
    ("detroit", "Detroit", "MI", "Michigan", "48226", ["Warren", "Sterling Heights", "Dearborn", "Livonia", "Troy", "Southfield"]),
    ("seattle", "Seattle", "WA", "Washington", "98101", ["Tacoma", "Bellevue", "Everett", "Kent", "Renton", "Redmond"]),
    ("minneapolis", "Minneapolis", "MN", "Minnesota", "55401", ["St. Paul", "Bloomington", "Plymouth", "Brooklyn Park", "Eden Prairie", "Maple Grove"]),
    ("san-diego", "San Diego", "CA", "California", "92101", ["Chula Vista", "Oceanside", "Escondido", "Carlsbad", "El Cajon", "Santee"]),
    ("tampa", "Tampa", "FL", "Florida", "33602", ["St. Petersburg", "Clearwater", "Brandon", "Wesley Chapel", "Largo", "Riverview"]),
    ("denver", "Denver", "CO", "Colorado", "80202", ["Aurora", "Lakewood", "Thornton", "Arvada", "Westminster", "Centennial"]),
    ("baltimore", "Baltimore", "MD", "Maryland", "21201", ["Towson", "Columbia", "Glen Burnie", "Ellicott City", "Dundalk", "Catonsville"]),
    ("st-louis", "St. Louis", "MO", "Missouri", "63101", ["St. Charles", "O'Fallon", "Florissant", "Chesterfield", "Kirkwood", "Belleville"]),
    ("orlando", "Orlando", "FL", "Florida", "32801", ["Kissimmee", "Sanford", "Winter Park", "Apopka", "Clermont", "Oviedo"]),
    ("charlotte", "Charlotte", "NC", "North Carolina", "28202", ["Concord", "Gastonia", "Huntersville", "Matthews", "Mooresville", "Rock Hill"]),
    ("san-antonio", "San Antonio", "TX", "Texas", "78205", ["New Braunfels", "Schertz", "Boerne", "Converse", "Live Oak", "Helotes"]),
    ("portland", "Portland", "OR", "Oregon", "97204", ["Vancouver", "Beaverton", "Hillsboro", "Gresham", "Lake Oswego", "Tigard"]),
    ("sacramento", "Sacramento", "CA", "California", "95814", ["Elk Grove", "Roseville", "Folsom", "Citrus Heights", "Rancho Cordova", "Natomas"]),
]

HEAD_COMMON = (
    '<link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/marketplace/marketplace.css">\n'
    '<script defer src="/site.js"></script>\n'
    '<link rel="icon" href="/favicon.png" type="image/png"><link rel="apple-touch-icon" href="/apple-touch-icon.png">'
    '<meta property="og:image" content="https://www.byebyedoody.com/logo.png">'
    '<meta name="google-adsense-account" content="ca-pub-9649513249180280">'
    '<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-9649513249180280" crossorigin="anonymous"></script>'
)

HEADER = """<header class="site-header">
<a class="brand" href="/"><span class="brand-mark">B</span><span>ByeBye<span class="brand-accent">Doody</span><small>Yard cleanup made easy</small></span></a>
<button class="menu-toggle" aria-label="Open menu" aria-expanded="false">☰</button>
<nav class="nav"><a href="/services.html">Services</a><a href="/partners.html">Partners</a><a class="active" href="/work-with-us.html">Work with us</a><a href="/marketplace/">Marketplace</a><a href="/app/">My account</a><a class="nav-cta" href="/quote.html">Get a free quote</a></nav>
</header>"""

FOOTER = """<footer class="footer">
<a class="brand brand-footer" href="/"><span class="brand-mark">B</span><span>ByeBye<span class="brand-accent">Doody</span><small>Yard cleanup made easy</small></span></a>
<div class="footer-links"><a href="/">Home</a><a href="/services.html">Services</a><a href="/jobs/">Cleanup jobs</a><a href="/areas/">Service areas</a><a href="/marketplace/">Marketplace</a><a href="/contact.html">Contact</a><a href="/privacy.html">Privacy</a><a href="mailto:byebyedoody123@aol.com">Email us</a></div>
<p>© <span data-year></span> ByeByeDoody. All rights reserved.</p>
</footer>
<script defer src="/assistant.js?v=1"></script></body></html>"""


def esc(s):
    return html.escape(s, quote=True)


def label(city, st):
    return f"{city}, {st}" if st != "DC" else "Washington, DC"


def job_description_html(city_label, nearby):
    near = ", ".join(nearby)
    return (
        f"<p>ByeByeDoody is a referral marketplace that connects households with independent dog-waste cleanup pros. "
        f"We are now accepting independent providers in the {city_label} area, including {near}.</p>"
        "<p><strong>What you do</strong></p><ul>"
        "<li>Pick up and bag dog waste from residential yards, one-time or on a weekly route.</li>"
        "<li>Choose the jobs you want in your own ZIP codes and send your own price quote.</li>"
        "<li>Close gates, keep pets safe and dispose of waste lawfully.</li></ul>"
        "<p><strong>How it works</strong></p><ul>"
        "<li>Independent contractor role, not employment. You set your own prices and hours.</li>"
        "<li>Get instant email alerts for new requests in your ZIP codes. Quote in seconds with an AI price suggestion.</li>"
        "<li>You keep your full quoted rate. Customers pay a 20% platform fee on top.</li>"
        "<li>Pay is per job and set by you. Our price guide suggests about $15–$45 per weekly visit and $35–$95 per one-time cleanup, depending on dogs and yard size.</li>"
        "<li>Payouts go through Stripe straight to your bank.</li></ul>"
        "<p><strong>What you need</strong></p><ul>"
        "<li>Your own small cleanup business (a sole proprietorship is fine) and any local registration that applies.</li>"
        "<li>Your own tools, supplies and transportation.</li>"
        "<li>A smartphone with email, and a bank account for Stripe payouts.</li></ul>"
        "<p>Applying is free. Joining does not make you an employee, and the number of jobs or income is not guaranteed; "
        "it depends on customer demand in your ZIP codes and your quotes.</p>"
        f'<p>Apply: {SITE}{APPLY}</p>'
    )


def job_jsonld(slug, city, st, state_name, zipc, nearby):
    city_label = label(city, st)
    data = {
        "@context": "https://schema.org",
        "@type": "JobPosting",
        "title": "Dog Waste Cleanup Pro (Independent Contractor)",
        "description": job_description_html(city_label, nearby),
        "identifier": {"@type": "PropertyValue", "name": "ByeByeDoody", "value": f"BBD-PRO-{slug.upper()}"},
        "datePosted": DATE_POSTED,
        "validThrough": VALID_THROUGH,
        "employmentType": "CONTRACTOR",
        "directApply": False,
        "hiringOrganization": {
            "@type": "Organization",
            "name": "ByeByeDoody",
            "sameAs": SITE,
            "logo": f"{SITE}/logo.png",
        },
        "jobLocation": {
            "@type": "Place",
            "address": {
                "@type": "PostalAddress",
                "addressLocality": city,
                "addressRegion": st,
                "postalCode": zipc,
                "addressCountry": "US",
            },
        },
        "industry": "Pet services",
        "url": f"{SITE}/jobs/{slug}",
    }
    return json.dumps(data, ensure_ascii=False, indent=1).replace("</", "<\\/")


def city_page(slug, city, st, state_name, zipc, nearby):
    city_label = label(city, st)
    near = ", ".join(nearby[:-1]) + " and " + nearby[-1]
    title = f"Dog Poop Scooper Jobs in {city_label} – Independent Pros | ByeByeDoody"
    desc = (f"Independent dog-waste cleanup work in {city_label} and nearby {nearby[0]} and {nearby[1]}. "
            "Set your own prices and hours, get instant job alerts, keep your full rate and get paid through Stripe. Free to apply.")
    faq = {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        "mainEntity": [
            {"@type": "Question", "name": f"Is this a job or an independent contractor role in {city}?",
             "acceptedAnswer": {"@type": "Answer", "text": "It's an independent contractor role. You run your own small cleanup business, choose which jobs to quote, and set your own prices and hours."}},
            {"@type": "Question", "name": "How do I get paid?",
             "acceptedAnswer": {"@type": "Answer", "text": "After the customer pays and the job is done, your full quoted rate is paid out through Stripe to your bank account. Customers pay ByeByeDoody's 20% platform fee on top."}},
            {"@type": "Question", "name": "Does it cost anything to join?",
             "acceptedAnswer": {"@type": "Answer", "text": "No. Applying and receiving job alerts are free."}},
        ],
    }
    faq_json = json.dumps(faq, ensure_ascii=False).replace("</", "<\\/")
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="description" content="{esc(desc)}">
<title>{esc(title)}</title><link rel="canonical" href="{SITE}/jobs/{slug}">
<meta property="og:title" content="{esc(title)}"><meta property="og:description" content="{esc(desc)}"><meta property="og:url" content="{SITE}/jobs/{slug}"><meta property="og:type" content="website">
{HEAD_COMMON}
<script type="application/ld+json">
{job_jsonld(slug, city, st, state_name, zipc, nearby)}
</script>
<script type="application/ld+json">{faq_json}</script>
</head>
<body>
{HEADER}
<main>
<section class="page-hero"><p class="eyebrow">NOW ACCEPTING PROS IN {esc(city_label.upper())}</p><h1>Dog poop scooper jobs in {esc(city_label)}</h1><p>Run your own pet-waste cleanup business and pick up yard-cleanup requests from customers in {esc(near)}. You set your prices and hours, and you get paid through Stripe.</p><div class="button-row" style="justify-content:center"><a class="button button-dark" href="{APPLY}">Apply now (free)</a><a class="button button-outline-dark" style="border:1px solid #8da99b" href="/jobs/">Other cities</a></div></section>
<section class="section soft"><div class="section-heading"><p class="eyebrow">THE WORK</p><h2>Independent dog-waste cleanup in {esc(city)}</h2></div>
<div class="steps">
<article><span>01</span><h3>Apply in 2 minutes</h3><p>Sign in with email or Google, open Provider tools and add the {esc(city)}-area ZIP codes you want to serve.</p></article>
<article><span>02</span><h3>Get instant job alerts</h3><p>When a customer in one of your ZIP codes posts a request, you get an email right away.</p></article>
<article><span>03</span><h3>Quote your own price</h3><p>Use the AI price suggestion or your own number. Customers compare quotes and book online.</p></article>
<article><span>04</span><h3>Clean the yard</h3><p>After the customer pays you see the address and notes. Bag the waste, close the gate, mark the job done.</p></article>
<article><span>05</span><h3>Get paid</h3><p>Your full quoted rate goes to your bank through Stripe. The customer pays the 20% platform fee on top. Our price guide suggests about $15–$45 per weekly visit and $35–$95 per one-time cleanup.</p></article>
<article><span>06</span><h3>Build weekly routes</h3><p>Weekly and twice-weekly customers turn one-off jobs into a steady route you control.</p></article>
</div></section>
<section class="section"><div class="narrow">
<h2>Who this is for</h2>
<ul class="check-list"><li>People who want flexible, outdoor, self-employed work around {esc(city_label)}.</li><li>Existing pet-waste, lawn-care, dog-walking or pet-sitting businesses that want more customers.</li><li>Anyone with reliable transportation, basic tools (scooper, bags, gloves) and a smartphone.</li></ul>
<h2>You run your own business</h2>
<ul class="check-list"><li>You set your own prices and your own hours.</li><li>You choose which jobs to quote and can skip any job. Nobody assigns you work.</li><li>You use your own tools and business name, and you can keep your own customers and other work.</li><li>Location is never tracked in the background. It's shared only if you choose, only during a paid job.</li></ul>
<h2>What you need</h2>
<ul class="check-list"><li>Your own small cleanup business (a sole proprietorship is fine) and any {esc(state_name)} or local registration that applies to you.</li><li>Your own tools, supplies and any vehicle insurance you need.</li><li>Safe, respectful service: secure gates, pet safety and lawful waste disposal.</li><li>A bank account for Stripe payouts (entered on Stripe, never sent to us).</li></ul>
<p class="fineprint">ByeByeDoody is a referral marketplace that is new in {esc(city)}. Joining is free and does not make you an employee. We can't guarantee a number of jobs or income; how much work you get depends on customer demand in your ZIP codes and your quotes. Never email Social Security numbers, ID images or bank details.</p>
<p><a class="button button-dark" href="{APPLY}">Apply now</a></p>
</div></section>
</main>
{FOOTER}"""


def index_page():
    groups = {}
    for slug, city, st, state_name, *_ in CITIES:
        groups.setdefault(state_name, []).append((slug, label(city, st)))
    items = "".join(
        f'<li><strong>{esc(state)}:</strong> ' + ", ".join(f'<a class="text-link" href="/jobs/{s}">{esc(l)}</a>' for s, l in sorted(v, key=lambda x: x[1])) + "</li>"
        for state, v in sorted(groups.items())
    )
    title = "Dog Poop Scooper Jobs Near You – Independent Cleanup Pros | ByeByeDoody"
    desc = ("Independent dog-waste cleanup work in 25+ US metros. Set your own prices and hours, "
            "get instant job alerts and get paid through Stripe. Free to apply.")
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="description" content="{esc(desc)}">
<title>{esc(title)}</title><link rel="canonical" href="{SITE}/jobs/">
<meta property="og:title" content="{esc(title)}"><meta property="og:description" content="{esc(desc)}"><meta property="og:url" content="{SITE}/jobs/"><meta property="og:type" content="website">
{HEAD_COMMON}
</head>
<body>
{HEADER}
<main>
<section class="page-hero"><p class="eyebrow">INDEPENDENT CLEANUP PROVIDERS</p><h1>Dog poop scooper jobs near you</h1><p>ByeByeDoody is expanding nationwide. Independent pros in these metros can apply free, set their own prices and get instant alerts for yard-cleanup requests in their ZIP codes.</p><div class="button-row" style="justify-content:center"><a class="button button-dark" href="{APPLY}">Apply now (free)</a><a class="button button-outline-dark" style="border:1px solid #8da99b" href="/work-with-us.html">How it works</a></div></section>
<section class="section"><div class="narrow">
<h2>Cities we're recruiting in</h2>
<ul class="check-list">{items}</ul>
<p>Don't see your city? You can still apply and add your ZIP codes. Customers anywhere in the US can post requests, and you'll get alerts for the ones in your area.</p>
<p class="fineprint">Independent contractor roles, not employment. Joining is free. Jobs and income aren't guaranteed and depend on customer demand in your ZIP codes.</p>
<p><a class="button button-dark" href="{APPLY}">Apply now</a></p>
</div></section>
</main>
{FOOTER}"""


def update_sitemap():
    path = ROOT / "sitemap.xml"
    xml = path.read_text()
    urls = [f"{SITE}/jobs/"] + [f"{SITE}/jobs/{c[0]}" for c in CITIES]
    add = "".join(f"  <url><loc>{u}</loc><lastmod>{DATE_POSTED}</lastmod></url>\n" for u in urls if f"<loc>{u}</loc>" not in xml)
    if add:
        xml = xml.replace("</urlset>", add + "</urlset>")
        path.write_text(xml)


def main():
    out = ROOT / "jobs"
    out.mkdir(exist_ok=True)
    (out / "index.html").write_text(index_page())
    for c in CITIES:
        (out / f"{c[0]}.html").write_text(city_page(*c))
    update_sitemap()
    print(f"Wrote {len(CITIES)} city pages + index")


if __name__ == "__main__":
    main()
