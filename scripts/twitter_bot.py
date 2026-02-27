"""
Prismo Twitter Bot — Posts tweets about Prismo features with approval flow.

Usage:
    python scripts/twitter_bot.py              # Generate 3 tweets, ask for approval, post
    python scripts/twitter_bot.py --dry-run    # Generate tweets without posting
    python scripts/twitter_bot.py --post "text" # Post a single custom tweet
"""

import tweepy
import os
import sys
import random
from datetime import datetime
from pathlib import Path

# Load env from .env.local
def load_env():
    env_path = Path(__file__).parent.parent / '.env.local'
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                key, val = line.split('=', 1)
                os.environ.setdefault(key.strip(), val.strip())

load_env()

API_KEY = os.environ.get('TWITTER_API_KEY')
API_SECRET = os.environ.get('TWITTER_API_SECRET')
ACCESS_TOKEN = os.environ.get('TWITTER_ACCESS_TOKEN')
ACCESS_TOKEN_SECRET = os.environ.get('TWITTER_ACCESS_TOKEN_SECRET')

def get_client():
    return tweepy.Client(
        consumer_key=API_KEY,
        consumer_secret=API_SECRET,
        access_token=ACCESS_TOKEN,
        access_token_secret=ACCESS_TOKEN_SECRET,
    )

def get_v1_api():
    """V1.1 API needed for media uploads."""
    auth = tweepy.OAuthHandler(API_KEY, API_SECRET)
    auth.set_access_token(ACCESS_TOKEN, ACCESS_TOKEN_SECRET)
    return tweepy.API(auth)


# ─── Tweet Content Library ──────────────────────────────────────────────────

TWEET_TEMPLATES = [
    # Feature highlights
    {
        "category": "valuation",
        "tweets": [
            "Most platforms give you ONE valuation model. Prismo runs 7+ simultaneously — DCF, DDM, Graham, Earnings Power, and more — then combines them with ensemble learning.\n\nSmarter valuations. Better decisions.\n\n#StockAnalysis #Investing #Fintech",
            "Tired of relying on a single P/E ratio? Prismo's AdvanceValueNet combines DCF, DDM, Graham Number, and more into one intelligent score.\n\nThe future of stock valuation is here.\n\n#Investing #AI #StockMarket",
            "What's a stock really worth? Prismo doesn't guess — it runs 7 valuation models and uses neural networks to synthesize the answer.\n\nJoin the waitlist: prismo.us\n\n#Fintech #ValueInvesting",
        ]
    },
    {
        "category": "quality",
        "tweets": [
            "Company quality isn't just about revenue. Prismo scores stocks across 5 dimensions:\n\n• Profitability\n• Financial Strength\n• Efficiency\n• Growth\n• Economic Moat\n\nAll powered by AI.\n\n#StockAnalysis #AI #Investing",
            "Before you invest, know the quality. Prismo's CompanyQualityNet analyzes profitability, moat strength, financial health, and more — in seconds.\n\nprismo.us\n\n#Investing #Fintech #DueDiligence",
            "Not all growth stocks are created equal. Prismo detects whether a company is Growth, Value, Dividend, or Blend — and adjusts its analysis accordingly.\n\n#SmartInvesting #AI #StockMarket",
        ]
    },
    {
        "category": "features",
        "tweets": [
            "Prismo isn't just charts. It's:\n\n📊 21 analysis tabs\n🧠 Neural-powered valuations\n📈 Revenue forecasting\n🏗️ DuPont decomposition\n📋 Industry comparison\n🔮 Probability engine\n\nAll in one platform.\n\n#Fintech #StockAnalysis",
            "From WACC to CAGR, from SGR to DuPont — Prismo calculates everything you need for deep fundamental analysis.\n\nNo spreadsheets required.\n\nprismo.us\n\n#Investing #FundamentalAnalysis",
            "Revenue forecasting powered by neural networks. Prismo doesn't just show you the past — it models the future.\n\n#AI #StockMarket #Fintech #Investing",
        ]
    },
    {
        "category": "coming_soon",
        "tweets": [
            "Prismo is coming soon. 🚀\n\nThe first fully customizable multi-model stock valuation platform.\n\nEarly access by invitation.\n\nprismo.us\n\n#Fintech #Investing #ComingSoon",
            "We're building something different. Not another stock screener — a complete neural valuation system.\n\nPrismo. Coming soon.\n\nprismo.us\n\n#StockMarket #AI #Investing",
            "What if stock analysis was powered by 12 neural layers, 7+ valuation models, and real-time data?\n\nThat's Prismo.\n\nJoin the waitlist → prismo.us\n\n#Fintech #AI #Investing",
        ]
    },
    {
        "category": "education",
        "tweets": [
            "Did you know? The Sustainable Growth Rate (SGR) tells you how fast a company can grow without external financing.\n\nPrismo calculates it automatically for every stock.\n\n#InvestingTips #StockAnalysis #Finance",
            "The DuPont analysis breaks ROE into 3 components: profit margin, asset turnover, and financial leverage.\n\nPrismo runs this automatically so you can spot what's really driving returns.\n\n#Investing #FinancialAnalysis",
            "WACC (Weighted Average Cost of Capital) is the minimum return a company must earn to satisfy all investors.\n\nPrismo calculates it for every stock in seconds.\n\n#Finance #Investing #StockMarket",
            "Graham Number = sqrt(22.5 × EPS × Book Value). It estimates the max fair price for a stock.\n\nPrismo calculates this and 6 other valuation models simultaneously.\n\n#ValueInvesting #BenjaminGraham #Stocks",
        ]
    },
    {
        "category": "differentiator",
        "tweets": [
            "Yahoo Finance shows you data.\nMorningstar gives you ratings.\n\nPrismo gives you a neural-powered analysis that combines both — and goes deeper.\n\nprismo.us\n\n#Fintech #StockAnalysis #AI",
            "Most tools tell you WHAT happened. Prismo tells you WHY and WHAT'S NEXT.\n\n12 neural layers. 21 analysis tabs. One platform.\n\n#Investing #AI #Fintech",
            "Stock analysis shouldn't require a Bloomberg terminal. Prismo brings institutional-grade analysis to everyone.\n\nprismo.us\n\n#Democratize #Investing #Fintech",
        ]
    },
]


def generate_tweets(count=3):
    """Pick random tweets from different categories."""
    categories = random.sample(TWEET_TEMPLATES, min(count, len(TWEET_TEMPLATES)))
    tweets = []
    for cat in categories[:count]:
        tweet = random.choice(cat["tweets"])
        tweets.append({"category": cat["category"], "text": tweet})
    return tweets


def post_tweet(client, text, media_ids=None):
    """Post a tweet and return the response."""
    kwargs = {"text": text}
    if media_ids:
        kwargs["media_ids"] = media_ids
    response = client.create_tweet(**kwargs)
    return response


def upload_image(api_v1, image_path):
    """Upload an image and return the media_id."""
    media = api_v1.media_upload(str(image_path))
    return media.media_id


def approval_flow(tweets, dry_run=False):
    """Show tweets and ask for approval before posting."""
    client = get_client()

    print("\n" + "=" * 60)
    print(f"  PRISMO TWITTER BOT — {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    print("=" * 60)

    posted = []

    for i, tweet in enumerate(tweets, 1):
        print(f"\n--- Tweet {i}/{len(tweets)} [{tweet['category'].upper()}] ---")
        print(f"\n{tweet['text']}")
        print(f"\n  Characters: {len(tweet['text'])}/280")

        if dry_run:
            print("  [DRY RUN — not posting]")
            continue

        while True:
            choice = input("\n  [A]probar / [E]ditar / [S]altar / [Q]uit: ").strip().lower()

            if choice == 'a':
                try:
                    response = post_tweet(client, tweet['text'])
                    tweet_id = response.data['id']
                    print(f"  ✓ Posted! https://x.com/Prismo324254/status/{tweet_id}")
                    posted.append(tweet_id)
                except Exception as e:
                    print(f"  ✗ Error: {e}")
                break

            elif choice == 'e':
                print("  Escribi el tweet nuevo (Enter para confirmar):")
                new_text = input("  > ").strip()
                if new_text:
                    tweet['text'] = new_text
                    print(f"  Characters: {len(new_text)}/280")
                    if len(new_text) > 280:
                        print("  ⚠ Too long! Edit again.")
                        continue
                continue

            elif choice == 's':
                print("  — Skipped")
                break

            elif choice == 'q':
                print("\n  Bye!")
                return posted
            else:
                print("  Invalid option. Use A/E/S/Q")

    print(f"\n{'=' * 60}")
    print(f"  Done! Posted {len(posted)} tweet(s).")
    print("=" * 60 + "\n")
    return posted


def main():
    args = sys.argv[1:]

    if '--post' in args:
        idx = args.index('--post')
        text = ' '.join(args[idx + 1:])
        if not text:
            print("Usage: --post \"Your tweet text\"")
            sys.exit(1)
        client = get_client()
        response = post_tweet(client, text)
        print(f"✓ Posted! https://x.com/Prismo324254/status/{response.data['id']}")
        return

    dry_run = '--dry-run' in args
    count = 3

    tweets = generate_tweets(count)
    approval_flow(tweets, dry_run=dry_run)


if __name__ == '__main__':
    main()
