# Lorain County Bookings

A clean, modern public booking records site for Lorain County, Ohio. Automatically scrapes the county jail roster every 15 minutes via GitHub Actions and publishes to GitHub Pages.

## Quick Start

1. **Fork this repo** (or push to your own GitHub account)

2. **Enable GitHub Pages:**
   - Go to Settings → Pages
   - Source: Deploy from a branch
   - Branch: `main`, folder: `/ (root)`
   - Save

3. **Enable GitHub Actions:**
   - Go to Actions tab
   - Click "I understand my workflows, go ahead and enable them"
   - The scraper will run every 15 minutes automatically

4. **Run the scraper manually** (optional):
   - Go to Actions → "Scrape Lorain County Bookings"
   - Click "Run workflow"

That's it. The site will start populating with real data within minutes.

## Project Structure

```
├── .github/workflows/scrape.yml   # Cron job (every 15 min)
├── scraper/
│   ├── scraper.py                 # Python scraper
│   └── requirements.txt           # Dependencies
├── data/
│   └── bookings.json              # Auto-updated booking data
├── images/                        # Downloaded mugshot photos
├── css/style.css                  # Site styles
├── js/app.js                      # Site logic
├── index.html                     # Listing page
└── detail.html                    # Detail page
```

## How It Works

1. GitHub Actions runs `scraper/scraper.py` every 15 minutes
2. The scraper hits the Lorain County Tyler Technologies inmate roster
3. New bookings + mugshots are saved to `data/` and `images/`
4. Changes are auto-committed and pushed
5. GitHub Pages serves the updated static site

## Custom Domain

To use a custom domain (e.g. `lorainbookings.com`):

1. Buy a domain (~$12/year from Namecheap, Cloudflare, etc.)
2. In repo Settings → Pages → Custom domain, enter your domain
3. Add a CNAME record pointing to `yourusername.github.io`
4. Enable "Enforce HTTPS"

## Local Development

```bash
# Install scraper dependencies
pip install -r scraper/requirements.txt

# Run the scraper locally
python scraper/scraper.py

# Serve the site locally
python -m http.server 8000
# Visit http://localhost:8000
```

## Data Source

All data comes from the [Lorain County Inmate Inquiry](https://loraincooh-wii.publicsafety.tylerapp.com/Default) system, which is publicly accessible. Booking records are public information under Ohio law.
