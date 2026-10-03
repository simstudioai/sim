#!/usr/bin/env python3
"""
Sanitized acceptance fixture for a weekly digest — one HTML per member.

Preserves the supplied digest script structure and execution flows without live
identifiers or credentials. Writes previews under /tmp for sandbox execution.
"""

import json
import logging
import os
import re
import shutil
import subprocess
import time
import zipfile
from datetime import datetime, timezone, timedelta
from html import escape
from urllib.parse import quote, unquote

import requests

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)-7s %(message)s', datefmt='%H:%M:%S')
log = logging.getLogger('fellows')

BQ_PROJECT = 'fixture-project'
OUT_DIR = '/tmp/fellows-council-weekly'
EXPORT_ZIP = '/tmp/fellows-previews.zip'
GOOGLE_SERVICE_ACCOUNT_JSON = {{GOOGLE_SERVICE_ACCOUNT_JSON}}
HEADER_IMG = 'https://assets.example.test/fellows-email-header.png'
FIXED_ZIP_TIMESTAMP = (2026, 8, 3, 12, 0, 0)


def materialize_google_credentials():
    """Keep service-account credentials runtime-only and outside exported artifacts."""
    if not GOOGLE_SERVICE_ACCOUNT_JSON:
        return
    credentials = (
        json.loads(GOOGLE_SERVICE_ACCOUNT_JSON)
        if isinstance(GOOGLE_SERVICE_ACCOUNT_JSON, str)
        else GOOGLE_SERVICE_ACCOUNT_JSON
    )
    credential_dir = os.path.join(OUT_DIR, '.runtime')
    credential_path = os.path.join(credential_dir, 'google-service-account.json')
    os.makedirs(credential_dir, exist_ok=True)
    with open(credential_path, 'w') as credential_file:
        json.dump(credentials, credential_file)
    os.chmod(credential_path, 0o600)
    os.environ['GOOGLE_APPLICATION_CREDENTIALS'] = credential_path
    return credential_path


def cleanup_google_credentials(credential_path) -> None:
    """Remove runtime-only credentials before returning control to the caller."""
    if not credential_path:
        return
    if os.environ.get('GOOGLE_APPLICATION_CREDENTIALS') == credential_path:
        os.environ.pop('GOOGLE_APPLICATION_CREDENTIALS', None)
    if os.path.isfile(credential_path):
        os.remove(credential_path)
    credential_dir = os.path.dirname(credential_path)
    if os.path.isdir(credential_dir) and not os.listdir(credential_dir):
        os.rmdir(credential_dir)


def write_deterministic_export(paths: list) -> None:
    """Bundle only declared digest artifacts with stable ZIP metadata."""
    with zipfile.ZipFile(
        EXPORT_ZIP,
        'w',
        compression=zipfile.ZIP_DEFLATED,
        compresslevel=9,
    ) as archive:
        for path in sorted(paths, key=os.path.basename):
            info = zipfile.ZipInfo(os.path.basename(path), date_time=FIXED_ZIP_TIMESTAMP)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            with open(path, 'rb') as artifact:
                with archive.open(info, 'w') as archived_artifact:
                    shutil.copyfileobj(artifact, archived_artifact, length=1024 * 1024)

# Sanitized members preserve the supplied cohort shape without live identities.
FELLOWS = [
    {
        'user_id': 'fixture-fellow-1',
        'first_name': 'Ada',
        'last_name': 'Example',
        'email': 'ada@example.test',
    },
]

FOUNDING_COMMUNITY = [
    {
        'user_id': 'fixture-founding-1',
        'first_name': 'Morgan',
        'last_name': 'Example',
        'email': 'morgan@example.test',
    },
]

# Per-cohort branding. `member_of` slots into the footer ("You're receiving this
# as a member of {member_of}"); `weekly_title` is the hero headline suffix.
COHORTS = {
    'fellows': {
        'members': FELLOWS,
        'brand': {
            'weekly_title': 'Fellows Council Weekly',
            'member_of': 'the Roon Fellows Council',
            'campaign': 'Fellows Weekly',
            'inactive_aside': 'or fellowship eating you alive',
            'file_prefix': 'fellows_weekly',
            'utm': 'fellows_weekly',
        },
    },
    'founding': {
        'members': FOUNDING_COMMUNITY,
        'brand': {
            'weekly_title': 'Founding Community Weekly',
            'member_of': 'the Roon Founding Physician Community',
            'campaign': 'Founding Community Weekly',
            'inactive_aside': 'or the week just getting away from you',
            'file_prefix': 'founding_weekly',
            'utm': 'founding_weekly',
        },
    },
}

# Active branding — reassigned in main() based on --cohort. Renderers read this.
BRAND = COHORTS['fellows']['brand']

# --- BQ helpers -------------------------------------------------------------

def bq(query: str, desc: str = '') -> list:
    log.info(f'BQ: {desc}')
    r = subprocess.run(
        ['bq', 'query', f'--project_id={BQ_PROJECT}', '--use_legacy_sql=false',
         '--format=json', '--max_rows=2000', query],
        capture_output=True, text=True, timeout=120,
    )
    if r.returncode != 0:
        log.error(f'BQ failed ({desc}): stderr={r.stderr[:600]!r} stdout={r.stdout[:400]!r}')
        return []
    return json.loads(r.stdout or '[]')


def strip_mentions(text: str) -> str:
    if not text:
        return ''
    t = re.sub(r'\$\{mention:[^,]+,([^}]+)\}', lambda m: unquote(m.group(1)), text)
    t = re.sub(r'\s+,', ',', t)
    t = re.sub(r'\s{2,}', ' ', t)
    return t.strip()


def truncate(text: str, n: int) -> str:
    text = strip_mentions(text or '')
    if len(text) <= n:
        return text
    cut = text[:n].rsplit(' ', 1)[0]
    return cut + '…'


UTM = 'fellows_weekly'
ROON_DOCTORS_HOME = f'https://www.roon.com/doctors/?utm_campaign={UTM}'


def post_url(post_id: str, post_type: str = 'POST') -> str:
    """Canonical Roon post URL.
    /doctors/rounds/{id} for ROUND type, /doctors/posts/{id} otherwise.
    Matches email_campaign_builder.py and build_personalized_campaign.py."""
    seg = 'rounds' if (post_type or '').upper() == 'ROUND' else 'posts'
    return f'https://www.roon.com/doctors/{seg}/{post_id}?utm_campaign={UTM}'


def profile_url(display_name: str) -> str | None:
    """Canonical Roon physician profile URL — requires display_name."""
    if not display_name:
        return None
    return f'https://www.roon.com/doctors/p/{quote(display_name, safe="")}?utm_campaign={UTM}'


GCS_BASE = 'https://assets.example.test/profile-images'


def photo_url(thumbnail: str | None) -> str | None:
    """Build full GCS URL for a Roon profile photo. Per BQ guide: URL-encode
    the path (preserve slashes). Returns None if no thumbnail."""
    if not thumbnail or not thumbnail.strip():
        return None
    return f'{GCS_BASE}/{quote(thumbnail.strip(), safe="/")}'


def member_slug(fellow: dict) -> str:
    """Stable, collision-safe slug for a member's preview file + meta key. Uses
    the precomputed `slug` (set by fetch_founding_cohort to disambiguate duplicate
    names); falls back to first_last for the hardcoded preview lists."""
    return fellow.get('slug') or (
        f"{fellow['first_name']}_{fellow['last_name']}".lower().replace(' ', '_').replace("'", ''))


# --- Data pulls -------------------------------------------------------------

def fetch_profiles() -> dict:
    ids = ','.join(f"'{f['user_id']}'" for f in FELLOWS)
    q = f"""
    SELECT u.id, u.first_name, u.last_name, u.email, u.last_login, u.created_at,
           u.thumbnail, s.name AS specialty, s.subspecialty
    FROM `{BQ_PROJECT}.fixture_public.users_user` u
    JOIN `{BQ_PROJECT}.fixture_public.users_specialty` s ON u.specialty_id = s.id
    WHERE u.id IN ({ids})
    """
    return {r['id']: r for r in bq(q, 'fellow profiles')}


def fetch_activity(window_days: int = 7) -> dict:
    """Per-fellow counts of posts, comments, reactions in last N days."""
    ids = ','.join(f"'{f['user_id']}'" for f in FELLOWS)
    q = f"""
    WITH fellows AS (SELECT id FROM `{BQ_PROJECT}.fixture_public.users_user` WHERE id IN ({ids}))
    SELECT f.id,
      (SELECT COUNT(*) FROM `{BQ_PROJECT}.fixture_public.feeds_post` p
         WHERE p.author_id=f.id AND p.is_active=TRUE AND p.parent_id IS NULL
           AND (p.type!='REPOST' OR p.text!='')
           AND p.created_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL {window_days} DAY)) AS posts,
      (SELECT COUNT(*) FROM `{BQ_PROJECT}.fixture_public.feeds_post` p
         WHERE p.author_id=f.id AND p.is_active=TRUE AND p.parent_id IS NOT NULL
           AND p.created_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL {window_days} DAY)) AS comments,
      (SELECT COUNT(*) FROM `{BQ_PROJECT}.fixture_public.feeds_reaction` r
         WHERE r.user_id=f.id AND r.is_active=TRUE
           AND r.created_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL {window_days} DAY)) AS reactions,
      (SELECT COUNT(*) FROM `{BQ_PROJECT}.fixture_public.feeds_post` p
         WHERE p.author_id=f.id AND p.is_active=TRUE AND p.parent_id IS NULL
           AND p.type='ROUND'
           AND p.created_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL {window_days} DAY)) AS rounds
    FROM fellows f
    """
    return {r['id']: {k: int(v) for k, v in r.items() if k != 'id'} for r in bq(q, f'activity {window_days}d')}


STREAK_WEEKS_BACK = 14
STREAK_MILESTONE = 10   # weeks to the highlight + special gift


def fetch_weekly_streak_data(user_ids: list) -> dict:
    """Per-user, per-7-day-bucket post & comment counts over STREAK_WEEKS_BACK
    weeks → {uid: {wk: (posts, comments)}}. Bucket 0 = most recent 168h. Post /
    comment rules mirror fetch_activity()."""
    if not user_ids:
        return {}
    ids = ','.join(f"'{u}'" for u in user_ids)
    days = STREAK_WEEKS_BACK * 7
    q = f"""
    WITH cohort AS (SELECT id FROM `{BQ_PROJECT}.fixture_public.users_user` WHERE id IN ({ids})),
    items AS (
      SELECT p.author_id AS uid,
        DIV(TIMESTAMP_DIFF(CURRENT_TIMESTAMP(), p.created_at, HOUR), 168) AS wk,
        CASE WHEN p.parent_id IS NULL AND (p.type!='REPOST' OR p.text!='') THEN 1 ELSE 0 END AS is_post,
        CASE WHEN p.parent_id IS NOT NULL THEN 1 ELSE 0 END AS is_comment
      FROM `{BQ_PROJECT}.fixture_public.feeds_post` p
      WHERE p.is_active=TRUE AND p.author_id IN (SELECT id FROM cohort)
        AND p.created_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL {days} DAY))
    SELECT uid, wk, SUM(is_post) AS posts, SUM(is_comment) AS comments
    FROM items WHERE wk BETWEEN 0 AND {STREAK_WEEKS_BACK - 1} GROUP BY uid, wk
    """
    by_user = {}
    for r in bq(q, f'streak weekly buckets ({STREAK_WEEKS_BACK}w)'):
        by_user.setdefault(r['uid'], {})[int(r['wk'])] = (int(r['posts']), int(r['comments']))
    return by_user


def compute_streak(buckets: dict) -> int:
    """Consecutive most-recent weeks (from wk 0) with >=1 post AND >=1 comment."""
    streak, wk = 0, 0
    while True:
        posts, comments = (buckets or {}).get(wk, (0, 0))
        if posts >= 1 and comments >= 1:
            streak += 1
            wk += 1
        else:
            break
    return streak


def fetch_streaks(user_ids: list) -> dict:
    """{uid: streak_weeks} for the cohort."""
    data = fetch_weekly_streak_data(user_ids)
    return {uid: compute_streak(b) for uid, b in data.items()}


def fetch_their_threads() -> dict:
    """Threads each fellow participated in (authored top-level OR commented) in last 7d.
    Returns {user_id: [thread dicts]}"""
    ids = ','.join(f"'{f['user_id']}'" for f in FELLOWS)
    q = f"""
    WITH fellows AS (SELECT id FROM `{BQ_PROJECT}.fixture_public.users_user` WHERE id IN ({ids})),
    -- Their own top-level posts
    their_posts AS (
      SELECT p.author_id AS user_id, p.id AS post_id, p.text AS post_text, p.type AS post_type,
             p.created_at AS event_at, 'authored' AS role
      FROM `{BQ_PROJECT}.fixture_public.feeds_post` p
      JOIN fellows f ON f.id = p.author_id
      WHERE p.is_active=TRUE AND p.parent_id IS NULL AND (p.type!='REPOST' OR p.text!='')
        AND p.created_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY)
    ),
    -- Posts they commented on
    their_comments AS (
      SELECT c.author_id AS user_id, c.parent_id AS post_id, p.text AS post_text, p.type AS post_type,
             MAX(c.created_at) AS event_at, 'commented' AS role
      FROM `{BQ_PROJECT}.fixture_public.feeds_post` c
      JOIN fellows f ON f.id = c.author_id
      JOIN `{BQ_PROJECT}.fixture_public.feeds_post` p ON p.id = c.parent_id
      WHERE c.is_active=TRUE AND c.parent_id IS NOT NULL
        AND c.created_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY)
        AND p.is_active=TRUE
      GROUP BY c.author_id, c.parent_id, p.text, p.type
    ),
    combined AS (
      SELECT * FROM their_posts UNION ALL SELECT * FROM their_comments
    )
    SELECT c.user_id, c.post_id, c.post_text, c.post_type, c.role, c.event_at,
      (SELECT COUNT(*) FROM `{BQ_PROJECT}.fixture_public.feeds_reaction` r
         WHERE r.post_id=c.post_id AND r.is_active=TRUE) AS thread_reactions,
      (SELECT COUNT(*) FROM `{BQ_PROJECT}.fixture_public.feeds_post` rp
         WHERE rp.parent_id=c.post_id AND rp.is_active=TRUE) AS thread_replies,
      (SELECT COUNT(*) FROM `{BQ_PROJECT}.fixture_public.feeds_post` rp
         WHERE rp.parent_id=c.post_id AND rp.is_active=TRUE
           AND rp.created_at > c.event_at) AS new_replies_since,
      (SELECT u2.first_name || ' ' || u2.last_name FROM `{BQ_PROJECT}.fixture_public.users_user` u2
         JOIN `{BQ_PROJECT}.fixture_public.feeds_post` p2 ON p2.author_id=u2.id
         WHERE p2.id=c.post_id) AS post_author,
      (SELECT s2.name FROM `{BQ_PROJECT}.fixture_public.users_specialty` s2
         JOIN `{BQ_PROJECT}.fixture_public.users_user` u3 ON u3.specialty_id=s2.id
         JOIN `{BQ_PROJECT}.fixture_public.feeds_post` p3 ON p3.author_id=u3.id
         WHERE p3.id=c.post_id) AS post_specialty
    FROM combined c
    ORDER BY c.user_id, c.event_at DESC
    """
    out = {}
    for r in bq(q, 'threads fellows participated in'):
        out.setdefault(r['user_id'], []).append(r)
    return out


def fetch_trending_global(limit: int = 3) -> list:
    q = f"""
    SELECT p.id AS post_id, p.text AS post_text, p.type AS post_type,
      u.first_name, u.last_name, s.name AS specialty,
      (SELECT COUNT(*) FROM `{BQ_PROJECT}.fixture_public.feeds_reaction` r
         WHERE r.post_id=p.id AND r.is_active=TRUE) AS reactions,
      (SELECT COUNT(*) FROM `{BQ_PROJECT}.fixture_public.feeds_post` rp
         WHERE rp.parent_id=p.id AND rp.is_active=TRUE) AS replies
    FROM `{BQ_PROJECT}.fixture_public.feeds_post` p
    JOIN `{BQ_PROJECT}.fixture_public.users_user` u ON u.id = p.author_id
    JOIN `{BQ_PROJECT}.fixture_public.users_specialty` s ON u.specialty_id = s.id
    WHERE p.is_active=TRUE AND p.parent_id IS NULL AND (p.type!='REPOST' OR p.text!='')
      AND p.created_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY)
      AND u.type='FULL' AND u.is_redeemed=TRUE
      AND LENGTH(p.text) > 40
    ORDER BY (
      (SELECT COUNT(*) FROM `{BQ_PROJECT}.fixture_public.feeds_reaction` r
         WHERE r.post_id=p.id AND r.is_active=TRUE) +
      (SELECT COUNT(*) FROM `{BQ_PROJECT}.fixture_public.feeds_post` rp
         WHERE rp.parent_id=p.id AND rp.is_active=TRUE) * 2
    ) DESC
    LIMIT {limit}
    """
    return bq(q, 'global trending')


def fetch_curated_by_specialty(specialties: list, limit_per: int = 5) -> dict:
    """Top posts per specialty in last 7d, for inactive fellows who need curated content."""
    if not specialties:
        return {}
    specs_sql = ','.join(f"'{s}'" for s in set(specialties) if s)
    q = f"""
    WITH ranked AS (
      SELECT p.id AS post_id, p.text AS post_text, p.type AS post_type,
        u.first_name, u.last_name, s.name AS specialty,
        (SELECT COUNT(*) FROM `{BQ_PROJECT}.fixture_public.feeds_reaction` r
           WHERE r.post_id=p.id AND r.is_active=TRUE) AS reactions,
        (SELECT COUNT(*) FROM `{BQ_PROJECT}.fixture_public.feeds_post` rp
           WHERE rp.parent_id=p.id AND rp.is_active=TRUE) AS replies,
        ROW_NUMBER() OVER (PARTITION BY s.name ORDER BY
          (SELECT COUNT(*) FROM `{BQ_PROJECT}.fixture_public.feeds_reaction` r
             WHERE r.post_id=p.id AND r.is_active=TRUE) +
          (SELECT COUNT(*) FROM `{BQ_PROJECT}.fixture_public.feeds_post` rp
             WHERE rp.parent_id=p.id AND rp.is_active=TRUE) * 2 DESC) AS rn
      FROM `{BQ_PROJECT}.fixture_public.feeds_post` p
      JOIN `{BQ_PROJECT}.fixture_public.users_user` u ON u.id = p.author_id
      JOIN `{BQ_PROJECT}.fixture_public.users_specialty` s ON u.specialty_id = s.id
      WHERE p.is_active=TRUE AND p.parent_id IS NULL AND (p.type!='REPOST' OR p.text!='')
        AND p.created_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY)
        AND u.type='FULL' AND u.is_redeemed=TRUE
        AND LENGTH(p.text) > 40
        AND s.name IN ({specs_sql})
    )
    SELECT * FROM ranked WHERE rn <= {limit_per}
    """
    out = {}
    for r in bq(q, f'curated for {len(set(specialties))} specialties'):
        out.setdefault(r['specialty'], []).append(r)
    return out


def fetch_physicians_reached() -> dict:
    """All-time cumulative post-view impressions on each cohort member's content
    ('physicians reached' headline). Attributed via PostID→author; self-views
    excluded. Amplitude tracking began ~Dec 2025, so 'all-time' = since then.
    Returns {user_id: total_impressions}."""
    ids = ','.join(f"'{f['user_id']}'" for f in FELLOWS)
    q = f"""
    SELECT p.author_id AS uid, COUNT(*) AS reached
    FROM `{BQ_PROJECT}.fixture_analytics.events` e
    JOIN `{BQ_PROJECT}.fixture_public.feeds_post` p
      ON p.id = JSON_VALUE(e.event_properties, '$.PostID')
    WHERE e.event_type = 'post-view'
      AND p.author_id IN ({ids})
      AND (e.user_id IS NULL OR e.user_id != p.author_id)
    GROUP BY 1
    """
    return {r['uid']: int(r['reached']) for r in bq(q, 'physicians reached (all-time impressions)')}


def fetch_founding_cohort(signed_only: bool = True) -> list:
    """Dynamically load the full Founding Community / hypernode cohort from BQ:
    affiliated users who are Launched, on a Hyper / Hyper High Touch / Core tier,
    with a live Roon account. `signed_only` restricts Contract to 'Signed' (drops
    'Not Applicable'). Returns FELLOWS-shaped dicts each with a collision-safe
    `slug` so duplicate names (e.g. two 'David Cohen's) get distinct files +
    meta keys end-to-end."""
    contracts = "('Signed')" if signed_only else "('Signed','Not Applicable')"
    q = f"""
    WITH cohort AS (
      SELECT DISTINCT NULLIF(TRIM(aff.UserID), '') AS uid
      FROM `{BQ_PROJECT}.fixture_affiliated.airtable_sync_data` aff
      WHERE aff.Contact_Status = 'Launched'
        AND TRIM(aff.Contract) IN {contracts}
        AND TRIM(aff.Node_Tier) IN ('Hyper','Core','Hyper High Touch')
        AND NULLIF(TRIM(aff.UserID), '') IS NOT NULL
    )
    SELECT u.id AS user_id, u.first_name, u.last_name, u.email
    FROM cohort c
    JOIN `{BQ_PROJECT}.fixture_public.users_user` u
      ON u.id = c.uid AND u.type = 'FULL' AND u.is_redeemed = TRUE
    WHERE u.email IS NOT NULL AND u.email != ''
      AND u.first_name IS NOT NULL AND u.last_name IS NOT NULL
    ORDER BY u.last_name, u.first_name
    """
    rows = bq(q, f'founding/hypernode cohort (signed_only={signed_only})')

    def _clean(name: str, is_last: bool) -> str:
        # Some users bake credentials into the name field ("Abdelsattar, MD",
        # "Thachil, MD, MBA"). The greeting is "Dr. {last}", so drop anything
        # after a comma on the surname and trim whitespace. Surnames don't
        # legitimately contain commas, so this is safe.
        n = (name or '').strip()
        if is_last and ',' in n:
            n = n.split(',', 1)[0].strip()
        return n

    members = [{'user_id': r['user_id'],
                'first_name': _clean(r['first_name'], is_last=False),
                'last_name': _clean(r['last_name'], is_last=True),
                'email': r['email']} for r in rows]
    # Collision-safe slugs: when two members share first+last, disambiguate ALL
    # of them with a short user_id suffix so filenames + meta keys stay unique.
    by_base = {}
    for m in members:
        s = f"{m['first_name']}_{m['last_name']}".lower().replace(' ', '_').replace("'", '')
        by_base.setdefault(s, []).append(m)
    for s, group in by_base.items():
        if len(group) == 1:
            group[0]['slug'] = s
        else:
            for m in group:
                m['slug'] = f"{s}_{m['user_id'][-4:].lower()}"
    return members


def fetch_recent_posts_pool(days: int = 30, limit: int = 500) -> list:
    """Recent active top-level posts across Roon with author specialty +
    subspecialty, text, and engagement — the shared pool for 'Join the
    conversation' (interest-matched) and 'Trending in your specialty'."""
    q = f"""
    SELECT p.id AS post_id, p.text AS post_text, p.type AS post_type, p.author_id,
      u.first_name, u.last_name, u.thumbnail, s.name AS specialty, s.subspecialty AS subspecialty,
      (SELECT COUNT(*) FROM `{BQ_PROJECT}.fixture_public.feeds_reaction` r
         WHERE r.post_id=p.id AND r.is_active=TRUE) AS reactions,
      (SELECT COUNT(*) FROM `{BQ_PROJECT}.fixture_public.feeds_post` rp
         WHERE rp.parent_id=p.id AND rp.is_active=TRUE) AS replies
    FROM `{BQ_PROJECT}.fixture_public.feeds_post` p
    JOIN `{BQ_PROJECT}.fixture_public.users_user` u ON u.id = p.author_id
    JOIN `{BQ_PROJECT}.fixture_public.users_specialty` s ON u.specialty_id = s.id
    WHERE p.is_active=TRUE AND p.parent_id IS NULL AND (p.type!='REPOST' OR p.text!='')
      AND p.created_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL {days} DAY)
      AND u.type='FULL' AND u.is_redeemed=TRUE
      AND LENGTH(p.text) > 40
    ORDER BY p.created_at DESC
    LIMIT {limit}
    """
    return bq(q, f'recent posts pool ({days}d)')


_KW_STOP = {'the', 'and', 'for', 'with', 'from', 'into', 'are', 'was', 'were', 'this',
            'that', 'have', 'has', 'not', 'you', 'your', 'our', 'their', 'about', 'over',
            'patients', 'patient', 'study', 'clinical', 'care', 'using', 'role', 'novel',
            'among', 'after', 'between', 'versus', 'review', 'case', 'report'}


def _member_keywords(interests: list, pub_titles: list) -> set:
    """Significant lowercase tokens (len ≥ 5) describing the member's topical
    interests — from their extracted interests + publication titles. Length floor
    + stopwords cut generic noise ('care', 'study') that caused loose matches."""
    kws = set()
    for phrase in (interests or []) + (pub_titles or []):
        for w in re.findall(r'[a-z0-9]{5,}', (phrase or '').lower()):
            if w not in _KW_STOP:
                kws.add(w)
    return kws


def _post_engagement(p: dict) -> int:
    return int(p.get('reactions') or 0) + 2 * int(p.get('replies') or 0)


def rank_relevant_posts(profile: dict, interests: list, keywords: set, pool: list,
                        own_uid: str, exclude_ids: set, k: int = 3) -> list:
    """'Join the conversation' — recent posts genuinely relevant to the member by
    topical interest or subspecialty (NOT bare specialty — that's the other
    section). A full interest phrase in the text is a strong signal; individual
    keyword tokens are weak; word boundaries avoid substring false-positives.
    Requires a real signal (relevance > 0); ranks relevance first, engagement second."""
    subspec = (profile.get('subspecialty') or '').strip()
    interest_phrases = [p.lower() for p in (interests or []) if len(p) >= 6]
    scored = []
    for p in pool:
        if p['author_id'] == own_uid or p['post_id'] in exclude_ids:
            continue
        text = (p.get('post_text') or '').lower()
        phrase_hits = sum(1 for ph in interest_phrases if ph in text)
        tok_hits = sum(1 for w in keywords if re.search(r'\b' + re.escape(w) + r'\b', text))
        subspec_match = 1 if subspec and (p.get('subspecialty') or '').strip() == subspec else 0
        relevance = 3 * phrase_hits + tok_hits + 2 * subspec_match
        if relevance == 0:
            continue
        scored.append((relevance, _post_engagement(p), p))
    scored.sort(key=lambda t: (-t[0], -t[1]))
    return [p for _, _, p in scored[:k]]


def rank_specialty_trending(profile: dict, pool: list, own_uid: str,
                            exclude_ids: set, k: int = 3) -> list:
    """'Trending in your specialty' — pure specialty/subspecialty trending by
    engagement, no interest matching."""
    spec = (profile.get('specialty') or '').strip()
    subspec = (profile.get('subspecialty') or '').strip()
    cands = [p for p in pool
             if p['author_id'] != own_uid and p['post_id'] not in exclude_ids
             and ((spec and (p.get('specialty') or '').strip() == spec)
                  or (subspec and (p.get('subspecialty') or '').strip() == subspec))]
    cands.sort(key=lambda p: -_post_engagement(p))
    return cands[:k]


def _conv_relevance(p: dict, phrases: list, keywords: set, subspec: str):
    """(relevance_score, very_relevant) for a post vs a member. very_relevant =
    a strong personal signal: a full interest phrase in the text OR a
    subspecialty match (NOT a lone keyword token)."""
    text = (p.get('post_text') or '').lower()
    ph = sum(1 for x in phrases if x in text)
    tok = sum(1 for w in keywords if re.search(r'\b' + re.escape(w) + r'\b', text))
    ss = 1 if subspec and (p.get('subspecialty') or '').strip() == subspec else 0
    return 3 * ph + tok + 2 * ss, (ph >= 1 or ss == 1)


def select_conversations(profile: dict, interests: list, keywords: set, pool: list,
                         own_uid: str, k: int = 5, max_personal: int = 2,
                         exclude_ids: set = None) -> list:
    """Compose one 'Conversations to Join' list — a deliberate mix of posts
    personal to the member plus specialty/global trending, with guardrails that
    fix the author-wall / dead-post / off-topic problems:
      • at most ONE card per author (no single-author walls),
      • prefer posts with MORE THAN ONE reply (real discussions) — UNLESS a post
        is *very relevant* to the member (interest phrase or subspecialty), which
        overrides the reply floor,
      • 'personal' slots require a strong signal (phrase or subspecialty), capped
        at max_personal so trending always gets a look (a deliberate mix),
      • falls back specialty -> global -> any so the section is never short.
    Replaces the old relevant-first-then-fill merge."""
    spec = (profile.get('specialty') or '').strip()
    subspec = (profile.get('subspecialty') or '').strip()
    phrases = [p.lower() for p in (interests or []) if len(p) >= 6]
    exclude_ids = exclude_ids or set()
    scored = []
    for p in pool:
        if p['author_id'] == own_uid or p['post_id'] in exclude_ids:
            continue
        rel, very = _conv_relevance(p, phrases, keywords, subspec)
        same = ((spec and (p.get('specialty') or '').strip() == spec)
                or (subspec and (p.get('subspecialty') or '').strip() == subspec))
        scored.append({'p': p, 'rel': rel, 'very': very, 'same': same})

    used_authors, chosen = set(), []

    def take(c) -> bool:
        a = f"{c['p']['first_name']} {c['p']['last_name']}"
        if a in used_authors or len(chosen) >= k:
            return False
        used_authors.add(a)
        chosen.append(c['p'])
        return True

    def reps(c) -> int:
        return int(c['p'].get('replies') or 0)

    # 1) Personal — strong signal only; may bypass the reply floor; capped.
    n = 0
    for c in sorted([c for c in scored if c['very']],
                    key=lambda c: (-c['rel'], -_post_engagement(c['p']))):
        if n >= max_personal:
            break
        if take(c):
            n += 1
    # 2) Specialty trending — real discussions (>1 reply) first.
    for c in sorted([c for c in scored if c['same'] and reps(c) > 1],
                    key=lambda c: -_post_engagement(c['p'])):
        take(c)
    # 3) Global trending — real discussions, author-diversified.
    for c in sorted([c for c in scored if reps(c) > 1],
                    key=lambda c: -_post_engagement(c['p'])):
        take(c)
    # 4) Relax to keep the section full (niche specialties / quiet weeks).
    if len(chosen) < k:
        for floor in (1, 0):
            for c in sorted([c for c in scored if reps(c) >= floor],
                            key=lambda c: -_post_engagement(c['p'])):
                take(c)
            if len(chosen) >= k:
                break
    return chosen[:k]


# --- Per-fellow interests (bio + pubs → topics) -----------------------------

INTERESTS_CACHE = '/tmp/fellows-council-weekly/runtime-cache/fellows_interests.json'
INTERESTS_TTL_DAYS = 30


def fetch_bios_and_pubs() -> dict:
    """Returns {user_id: {'bio': str, 'pub_titles': [str, ...]}} for all fellows."""
    ids = ','.join(f"'{f['user_id']}'" for f in FELLOWS)
    q = f"""
    WITH fellow_pubs AS (
      SELECT user_id, title, year,
        ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY year DESC, created_at DESC) AS rn
      FROM `{BQ_PROJECT}.fixture_public.users_publication`
      WHERE user_id IN ({ids}) AND is_active=TRUE AND title IS NOT NULL AND LENGTH(title) > 10
    )
    SELECT u.id, u.bio,
      ARRAY_AGG(p.title IGNORE NULLS ORDER BY p.rn LIMIT 8) AS pub_titles
    FROM `{BQ_PROJECT}.fixture_public.users_user` u
    LEFT JOIN fellow_pubs p ON p.user_id = u.id AND p.rn <= 8
    WHERE u.id IN ({ids})
    GROUP BY u.id, u.bio
    """
    out = {}
    for r in bq(q, 'bios + publications'):
        out[r['id']] = {
            'bio': (r.get('bio') or '').strip(),
            'pub_titles': [t for t in (r.get('pub_titles') or []) if t],
        }
    return out


INTEREST_PROMPT = """You help build a personalized research feed for a medical fellow.

Given this fellow's bio and recent publication titles, extract their 3-5 most specific clinical/research interests. These will be used as PubMed search keywords — so make them concrete search-friendly phrases, not broad specialty names.

Rules:
- Prefer narrow, specific topics over broad ones. ("CDK4/6 inhibitors" > "breast cancer", "structural heart imaging" > "cardiology")
- 2-4 words each, no articles ("the", "a"), no "research on", no adjectives like "novel".
- Return ONLY a JSON array of strings, nothing else. Example: ["monarchE trial", "CDK4/6 inhibitors", "MRD detection"]
- If bio + pubs don't provide enough signal, return an empty array [].

Specialty: {specialty}
Bio: {bio}
Recent publications:
{pubs}

JSON array only:"""


def _extract_interests_regex(bio: str, pub_titles: list) -> list:
    """Regex fallback when Haiku unavailable."""
    topics = set()
    b = (bio or '').replace('\n', ' ')
    # Patterns like "focus on X", "specializing in X", "interested in X", "expertise in X"
    patterns = [
        r'focus(?:ing|es|ed)?\s+on\s+([^.,;]+?)(?:[\.,;]|\sand\s|$)',
        r'special(?:izing|ization|ty|ist)?\s+in\s+([^.,;]+?)(?:[\.,;]|\sand\s|$)',
        r'interested?\s+in\s+([^.,;]+?)(?:[\.,;]|\sand\s|$)',
        r'research\s+(?:interest|focus|on|in)s?\s+(?:include|are|is|:)?\s*([^.,;]+?)(?:[\.,;]|$)',
        r'expertise\s+in\s+([^.,;]+?)(?:[\.,;]|\sand\s|$)',
        r'work(?:ing)?\s+on\s+([^.,;]+?)(?:[\.,;]|$)',
    ]
    for pat in patterns:
        for m in re.finditer(pat, b, flags=re.IGNORECASE):
            raw = m.group(1).strip()
            # split multi-item lists ("X, Y, and Z")
            for piece in re.split(r',| and |;', raw):
                t = piece.strip().lower().strip('.')
                # Drop generic words
                if 3 <= len(t) <= 60 and t not in {'medicine', 'research', 'clinical medicine', 'patients'}:
                    topics.add(t)
    # Pick 1-2 keywords from pub titles (big noun phrases)
    for title in pub_titles[:3]:
        # Grab capitalized multi-word noun phrases or known clinical terms
        t = title.lower()
        for phrase in re.findall(r'([a-z][a-z-]+(?:\s+[a-z][a-z-]+){1,3})', t):
            if any(k in phrase for k in ['cancer', 'therapy', 'trial', 'syndrome', 'imaging',
                                         'disease', 'disorder', 'failure', 'infarction',
                                         'biopsy', 'ablation', 'transplant', 'immunotherapy']):
                topics.add(phrase.strip())
                break
    return list(topics)[:5]


_BAD_TOPIC_PATTERNS = [
    r'^(the|a|an|and|or|for|with|of|in|on|at)\s', r'\s(the|a|an)$',
    r'^(broad|impactful|novel|innovative|current|recent|ongoing|general|dedicated)$',
    r'^(centered|focused|interested|working|specializing)\s',  # verb-fragments
    r'(?:research|interest|focus)s?\s+(?:on|in|include)',  # meta-phrases
]


def _clean_topics(topics: list) -> list:
    out = []
    for t in topics:
        t = (t or '').strip().strip('"\'.,;:')
        # Strip trailing prepositions/articles that indicate a cut-off phrase
        t = re.sub(r'\s+(from|in|on|at|of|the|a|an|by|to|for)\s*$', '', t, flags=re.IGNORECASE).strip()
        if not t or len(t) < 4 or len(t) > 60:
            continue
        if any(re.search(p, t, flags=re.IGNORECASE) for p in _BAD_TOPIC_PATTERNS):
            continue
        # Must contain at least one real medical/clinical noun-ish word
        # Drop if all words are generic
        words = t.lower().split()
        if len(words) == 1 and words[0] in {'broad', 'general', 'impactful', 'novel', 'medicine', 'research'}:
            continue
        out.append(t)
    # dedupe preserving order
    seen, dedup = set(), []
    for t in out:
        k = t.lower()
        if k not in seen:
            seen.add(k); dedup.append(t)
    return dedup[:5]


def extract_interests(user_id: str, first: str, last: str, specialty: str,
                      bio: str, pub_titles: list) -> list:
    """Return list of 3-5 PubMed-friendly topic keywords for this fellow."""
    if not bio and not pub_titles:
        return []
    try:
        pubs_str = '\n'.join(f'- {t}' for t in pub_titles[:6]) or '(none)'
        msg = _anthropic().messages.create(
            model='claude-haiku-4-5-20251001',
            max_tokens=200,
            messages=[{'role': 'user', 'content': INTEREST_PROMPT.format(
                specialty=specialty or 'medicine',
                bio=(bio or '(no bio)')[:800],
                pubs=pubs_str,
            )}],
        )
        text = ''.join(b.text for b in msg.content if hasattr(b, 'text')).strip()
        # Parse JSON array
        m = re.search(r'\[.*\]', text, flags=re.DOTALL)
        if m:
            arr = json.loads(m.group(0))
            if isinstance(arr, list):
                return _clean_topics([str(t) for t in arr if t])
    except Exception as e:
        log.warning(f'Haiku interest extraction failed for {first} {last}: {type(e).__name__}: {str(e)[:80]}')
    return _clean_topics(_extract_interests_regex(bio, pub_titles))


def load_interests_cache() -> dict:
    if not os.path.exists(INTERESTS_CACHE):
        return {}
    try:
        return json.load(open(INTERESTS_CACHE))
    except Exception:
        return {}


def save_interests_cache(cache: dict) -> None:
    os.makedirs(os.path.dirname(INTERESTS_CACHE), exist_ok=True)
    with open(INTERESTS_CACHE, 'w') as fh:
        json.dump(cache, fh, indent=2)


def build_fellow_interests(profiles: dict, refresh: bool = False) -> dict:
    """Build or load {user_id: {interests: [..], pub_titles: [..], bio: str, updated_at: iso}}."""
    cache = load_interests_cache()
    bios_pubs = fetch_bios_and_pubs()
    now = datetime.now(timezone.utc)
    ttl = INTERESTS_TTL_DAYS * 86400

    for fellow in FELLOWS:
        uid = fellow['user_id']
        cached = cache.get(uid)
        if cached and not refresh:
            try:
                updated = datetime.fromisoformat(cached['updated_at'].replace('Z', '+00:00'))
                if (now - updated).total_seconds() < ttl:
                    continue  # fresh
            except Exception:
                pass
        profile = profiles.get(uid, {})
        bp = bios_pubs.get(uid, {'bio': '', 'pub_titles': []})
        interests = extract_interests(
            uid, fellow['first_name'], fellow['last_name'],
            profile.get('specialty', ''), bp['bio'], bp['pub_titles'],
        )
        cache[uid] = {
            'first_name': fellow['first_name'],
            'last_name': fellow['last_name'],
            'specialty': profile.get('specialty', ''),
            'bio': bp['bio'][:600],
            'pub_titles': bp['pub_titles'][:5],
            'interests': interests,
            'updated_at': now.isoformat(),
        }
        log.info(f'  interests [{fellow["first_name"]} {fellow["last_name"]}]: {interests}')
    save_interests_cache(cache)
    return cache


# --- Haiku post-angle generator --------------------------------------------

_anthropic_client = None
def _anthropic():
    global _anthropic_client
    if _anthropic_client is None:
        import anthropic
        _anthropic_client = anthropic.Anthropic(api_key={{ANTHROPIC_API_KEY}})
    return _anthropic_client


POST_ANGLE_PROMPT = """You help medical fellows turn new research into engaging discussion posts on Roon, a physician-only platform.

Given a paper title, journal, and the fellow's specialty, write ONE short suggested post-angle (max 22 words) that frames the paper as a conversation starter for colleagues. It should sound like something a real fellow would say to their peers — not marketing copy.

Rules:
- Open with an action verb or question. Examples: "Ask your colleagues...", "Post: are you...", "Worth a thread on...", "Throw this out for discussion:"
- Be specific to the paper's actual substance — no generic filler.
- Don't say "interesting" or "groundbreaking" or "game-changing".
- No emojis. No quotes around the suggestion. Single sentence only.
- 22 words max.

Paper: {title}
Journal: {journal}
Specialty: {specialty}

Suggested post-angle:"""


def _fallback_angle(title: str, journal: str, specialty: str) -> str:
    """Keyword-driven fallback when Haiku is unavailable."""
    t = (title or '').lower()
    if any(k in t for k in ['trial', 'rct', 'randomized', 'phase ii', 'phase iii']):
        return 'Post the trial and ask: is this enough to change your practice, or are you waiting for more?'
    if any(k in t for k in ['guideline', 'recommendation', 'consensus']):
        return 'Share the new guideline and ask your colleagues: where does this land vs. what you\'re already doing?'
    if any(k in t for k in ['meta-analysis', 'systematic review']):
        return 'Throw the pooled data out — which piece actually holds up in your patient population?'
    if any(k in t for k in ['ai', 'machine learning', 'deep learning', 'llm', 'chatgpt']):
        return 'Start a thread: where does AI actually help here, and where does it still get things wrong?'
    if any(k in t for k in ['mortality', 'outcome', 'survival']):
        return 'Worth a post — which patients benefit, and which ones does this not apply to?'
    if any(k in t for k in ['resident', 'fellow', 'training', 'burnout', 'education']):
        return 'Drop this in and ask fellows at other programs what they\'re actually seeing.'
    if any(k in t for k in ['pregnancy', 'maternal', 'postpartum', 'obstetric']):
        return 'Post the paper and ask: are you counseling patients on this yet?'
    if any(k in t for k in ['disparities', 'equity', 'access']):
        return 'Share this one and ask: what\'s your institution doing about it?'
    return 'Post this and ask your colleagues: does this change how you\'d approach the next case?'


def post_angle(title: str, journal: str, specialty: str) -> str:
    """Generate a one-line 'share this on Roon' hook via Haiku. Keyword fallback on error."""
    if not title:
        return ''
    try:
        msg = _anthropic().messages.create(
            model='claude-haiku-4-5-20251001',
            max_tokens=120,
            messages=[{'role': 'user', 'content': POST_ANGLE_PROMPT.format(
                title=title[:220], journal=journal or 'journal', specialty=specialty or 'medicine')}],
        )
        text = ''.join(b.text for b in msg.content if hasattr(b, 'text')).strip()
        text = text.strip('"“”\' ').rstrip('.').strip()
        if len(text) > 200:
            text = text[:200].rsplit(' ', 1)[0] + '…'
        return text
    except Exception as e:
        log.warning(f'Haiku post-angle failed: {type(e).__name__}: {str(e)[:100]}')
        return _fallback_angle(title, journal, specialty)


# --- PubMed -----------------------------------------------------------------

PUBMED_KEY = {{NCBI_API_KEY}}
PUBMED_EMAIL = 'fixture@example.test'

# Specialty → PubMed search terms. Tuned for fellows-level relevance.
SPECIALTY_PUBMED_TERMS = {
    'Obstetrics & Gynecology': 'obstetrics OR gynecology OR "maternal health"',
    'Cardiology': 'cardiology OR "heart failure" OR "coronary disease" OR arrhythmia',
    'Hematology & Oncology': 'oncology OR hematology OR "cancer therapy" OR immunotherapy',
    'Internal Medicine': '"internal medicine" OR hospitalist OR "clinical medicine"',
    'Family Medicine': '"family medicine" OR "primary care"',
    'Radiology': 'radiology OR "diagnostic imaging"',
    'Emergency Medicine': '"emergency medicine" OR "acute care"',
    'Nephrology': 'nephrology OR "kidney disease"',
}

JOURNAL_WHITELIST = {
    # High-impact general + specialty to filter noise
    'n engl j med', 'jama', 'jama intern med', 'bmj', 'lancet', 'nature medicine',
    'ann intern med', 'j clin oncol', 'jco', 'blood', 'circulation', 'jacc',
    'j am coll cardiol', 'eur heart j', 'obstet gynecol', 'am j obstet gynecol',
    'ajog', 'gynecol oncol', 'fertil steril', 'breast cancer res treat',
    'lancet oncol', 'nejm evid', 'cell', 'science', 'annals of oncology',
    'j clin invest', 'circulation research', 'nature reviews',
}


def pubmed_search(term: str, days: int = 14, retmax: int = 10) -> list:
    """PubMed esearch returning PMIDs for term in date range."""
    params = {
        'db': 'pubmed',
        'term': f'({term}) AND hasabstract[Filter]',
        'retmode': 'json', 'retmax': retmax,
        'sort': 'relevance', 'email': PUBMED_EMAIL,
        'reldate': days, 'datetype': 'pdat',
    }
    if PUBMED_KEY:
        params['api_key'] = PUBMED_KEY
    try:
        r = requests.get('https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi',
                         params=params, timeout=15)
        r.raise_for_status()
        return r.json().get('esearchresult', {}).get('idlist', [])
    except Exception as e:
        log.warning(f'PubMed search failed ({term[:40]}): {e}')
        return []


def pubmed_fetch(pmids: list) -> list:
    """PubMed esummary for metadata (title, journal, date, authors)."""
    if not pmids:
        return []
    params = {
        'db': 'pubmed', 'id': ','.join(pmids), 'retmode': 'json', 'email': PUBMED_EMAIL,
    }
    if PUBMED_KEY:
        params['api_key'] = PUBMED_KEY
    try:
        r = requests.get('https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi',
                         params=params, timeout=20)
        r.raise_for_status()
        data = r.json().get('result', {})
    except Exception as e:
        log.warning(f'PubMed fetch failed: {e}')
        return []
    out = []
    for pmid in pmids:
        rec = data.get(pmid)
        if not rec:
            continue
        journal = (rec.get('fulljournalname') or rec.get('source') or '').strip()
        out.append({
            'pmid': pmid,
            'title': rec.get('title', '').strip().rstrip('.'),
            'journal': journal,
            'pubdate': rec.get('pubdate', '')[:10],
            'url': f'https://pubmed.ncbi.nlm.nih.gov/{pmid}/',
            'high_impact': journal.lower() in JOURNAL_WHITELIST or any(w in journal.lower() for w in JOURNAL_WHITELIST),
        })
    return out


def _quote_term(t: str) -> str:
    """Quote a multi-word term for PubMed."""
    t = t.strip().strip('"')
    return f'"{t}"' if ' ' in t else t


# ===========================================================================
# "Worth posting on Roon" — find the member's OWN recent work (publication or
# news mention) and ghostwrite a Roon post in their voice. Replaces the old
# interest-matched "Worth Bringing to Roon" PubMed section.
#
# Sourcing (decided 2026-06-01): (1) their own publications — matched from the
# `users_publication` titles we already cache, plus an institution-disambiguated
# author-name search for newer papers; (2) recent news/features about them via
# the Anthropic server-side web_search tool. If nothing is confidently theirs,
# the section is omitted entirely (no fabrication, no field-relevant fallback).
# Cohort-agnostic so the Hypernode digest can reuse find_own_work().
# ===========================================================================

OWNWORK_CACHE = '/tmp/fellows-council-weekly/runtime-cache/fellows_ownwork.json'
OWNWORK_TTL_DAYS = 7
EUTILS = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils'

# Only surface own-work published within this many months — keeps the weekly
# feeling current rather than dredging up year-old papers.
OWNWORK_RECENCY_MONTHS = 6

# "Weekly Digest Sends" table in Roon GTM Master — the per-send log + dedup
# ledger. We read Article Link per Roon User ID so a paper/news item we've
# already shared with a member is never re-surfaced.
AIRTABLE_PAT = {{AIRTABLE_PAT}}
AIRTABLE_BASE = 'fixture-base'
WEEKLY_SENDS_TABLE = 'fixture-weekly-sends'


def _parse_item_date(s: str):
    """Best-effort parse of a publication/news date into a datetime (day=1 when
    only year/month known). Handles '2026 Jan 1', '2025 Feb', '2026',
    '2025 Jan-Mar', '2026-03-09'. Returns None if unparseable."""
    if not s:
        return None
    s = str(s).strip()
    m = re.match(r'(\d{4})-(\d{2})(?:-(\d{2}))?', s)  # ISO
    if m:
        y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3) or 1)
        try:
            return datetime(y, mo, d, tzinfo=timezone.utc)
        except ValueError:
            return datetime(y, 1, 1, tzinfo=timezone.utc)
    m = re.match(r'(\d{4})', s)  # 'YYYY Mon ...' or bare 'YYYY'
    if not m:
        return None
    y = int(m.group(1))
    months = {'jan': 1, 'feb': 2, 'mar': 3, 'apr': 4, 'may': 5, 'jun': 6,
              'jul': 7, 'aug': 8, 'sep': 9, 'oct': 10, 'nov': 11, 'dec': 12}
    mo = 1
    mm = re.search(r'[A-Za-z]{3}', s)
    if mm:
        mo = months.get(mm.group(0).lower(), 1)
    return datetime(y, mo, 1, tzinfo=timezone.utc)


def _is_recent_enough(date_str: str, months: int = OWNWORK_RECENCY_MONTHS) -> bool:
    """True if the item's date is within the recency window. Bare-year dates
    (no month) pass when the year is >= the cutoff year (benefit of the doubt)."""
    dt = _parse_item_date(date_str)
    if not dt:
        return False
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(days=months * 31)
    # Bare 'YYYY' with no month parsed to Jan 1 — don't unfairly exclude a paper
    # that may be from later that year if the year itself is >= cutoff year.
    if re.fullmatch(r'\d{4}', str(date_str).strip()):
        return dt.year >= cutoff.year
    return dt >= cutoff


def fetch_shared_links(user_ids: list) -> dict:
    """Read the Weekly Digest Sends table → {roon_user_id: set(article_links)}
    already surfaced to that member, so we never repeat. Best-effort: on any
    Airtable error returns {} (we'd rather risk a rare repeat than crash)."""
    out = {}
    if not user_ids:
        return out
    url = f'https://api.airtable.com/v0/{AIRTABLE_BASE}/{WEEKLY_SENDS_TABLE}'
    headers = {'Authorization': f'Bearer {AIRTABLE_PAT}'}
    params = {'fields[]': ['Roon User ID', 'Article Link'], 'pageSize': 100}
    offset = None
    wanted = set(user_ids)
    try:
        while True:
            if offset:
                params['offset'] = offset
            r = requests.get(url, headers=headers, params=params, timeout=30)
            r.raise_for_status()
            data = r.json()
            for rec in data.get('records', []):
                f = rec.get('fields', {})
                uid = f.get('Roon User ID')
                link = f.get('Article Link')
                if uid in wanted and link:
                    out.setdefault(uid, set()).add(link.strip())
            offset = data.get('offset')
            if not offset:
                break
    except Exception as e:
        log.warning(f'Weekly Digest Sends read failed (dedup disabled this run): {type(e).__name__}: {str(e)[:120]}')
        return {}
    total = sum(len(v) for v in out.values())
    log.info(f'  dedup: {total} previously-shared item(s) across {len(out)} member(s)')
    return out

# Generic email domains that carry no institution signal (so author-name
# PubMed search can't be disambiguated → we skip it for these members).
_GENERIC_EMAIL_DOMAINS = {
    'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com',
    'aol.com', 'me.com', 'protonmail.com', 'pm.me',
}


def _institution_tokens(email: str) -> list:
    """Derive institution disambiguation tokens from an email domain.
    duke.edu → ['duke'], cumc.columbia.edu → ['cumc','columbia']. Returns []
    for generic consumer domains (no usable signal)."""
    dom = (email or '').split('@')[-1].lower().strip()
    if not dom or dom in _GENERIC_EMAIL_DOMAINS:
        return []
    parts = [p for p in dom.split('.') if p not in ('edu', 'org', 'com', 'net', 'gov', 'health', 'care', 'us')]
    # Drop bare 'mail'/'med'/'www' style prefixes that aren't institution names
    return [p for p in parts if len(p) >= 3 and p not in ('mail', 'www', 'med')]


def _pubmed_get(endpoint: str, params: dict, parse_json: bool = True):
    params = {**params, 'email': PUBMED_EMAIL}
    if PUBMED_KEY:
        params['api_key'] = PUBMED_KEY
    try:
        r = requests.get(f'{EUTILS}/{endpoint}', params=params, timeout=25)
        r.raise_for_status()
        return r.json() if parse_json else r.text
    except Exception as e:
        log.warning(f'PubMed {endpoint} failed: {type(e).__name__}: {str(e)[:120]}')
        return None


_STOPWORDS = {'the', 'and', 'for', 'with', 'from', 'into', 'are', 'was', 'were',
              'that', 'this', 'across', 'among', 'between', 'over', 'under', 'after'}


def _title_tokens(title: str) -> list:
    """Lowercased alphanumeric word tokens for overlap scoring."""
    return re.findall(r'[a-z0-9]+', (title or '').lower())


def _title_overlap(a: str, b: str) -> float:
    """Jaccard overlap of significant word tokens between two titles."""
    sa = {t for t in _title_tokens(a) if len(t) >= 3 and t not in _STOPWORDS}
    sb = {t for t in _title_tokens(b) if len(t) >= 3 and t not in _STOPWORDS}
    if not sa or not sb:
        return 0.0
    return len(sa & sb) / len(sa | sb)


def pubmed_title_lookup(title: str) -> str | None:
    """Find the PMID for a known (user-entered) publication title. ANDs the
    significant title words in the [Title] field, then verifies the best hit by
    word overlap so we don't latch onto a loosely-matching wrong paper. Robust
    to punctuation/number quirks that break exact-phrase search."""
    title = (title or '').strip().rstrip('.')
    if len(title) < 12:
        return None
    # Significant alpha tokens only (drop pure numbers / short / stopwords —
    # they error or over-broaden the [Title] query).
    toks = [t for t in _title_tokens(title)
            if len(t) >= 3 and not t.isdigit() and t not in _STOPWORDS][:12]
    if len(toks) < 2:
        return None
    term = ' AND '.join(f'{t}[Title]' for t in toks)
    data = _pubmed_get('esearch.fcgi', {'db': 'pubmed', 'term': term, 'retmax': 5, 'retmode': 'json'})
    ids = ((data or {}).get('esearchresult', {}) or {}).get('idlist', [])
    if not ids:
        return None
    # Verify: pick the candidate whose real title best matches ours.
    cands = pubmed_fetch(ids)
    best, best_ov = None, 0.0
    for c in cands:
        ov = _title_overlap(c['title'], title)
        if ov > best_ov:
            best, best_ov = c, ov
    return best['pmid'] if best and best_ov >= 0.55 else None


def pubmed_author_recent(last: str, first: str, inst_tokens: list, months: int = 30,
                         retmax: int = 12) -> list:
    """Recent PMIDs for `Lastname FI[Author]`, restricted to the date window.
    Returns [] when we have no institution token to disambiguate (too risky)."""
    if not last or not inst_tokens:
        return []
    fi = (first or '')[:1]
    author = f'{last} {fi}[Author]' if fi else f'{last}[Author]'
    today = datetime.now(timezone.utc)
    # Approximate the window in days; PubMed reldate is in days.
    reldate = months * 31
    data = _pubmed_get('esearch.fcgi', {
        'db': 'pubmed', 'term': author, 'retmax': retmax, 'retmode': 'json',
        'datetype': 'pdat', 'reldate': reldate, 'sort': 'pub_date',
    })
    return ((data or {}).get('esearchresult', {}) or {}).get('idlist', [])


def _parse_pubmed_xml(xml_text: str) -> dict:
    """Parse efetch XML → {pmid: {abstract, authors:[{last,fore,initials,affil}], year}}."""
    import xml.etree.ElementTree as ET
    out = {}
    if not xml_text:
        return out
    try:
        root = ET.fromstring(xml_text)
    except Exception as e:
        log.warning(f'PubMed XML parse failed: {str(e)[:120]}')
        return out
    for art in root.findall('.//PubmedArticle'):
        pmid_el = art.find('.//PMID')
        pmid = pmid_el.text if pmid_el is not None else None
        if not pmid:
            continue
        # Abstract — concatenate labeled sections
        chunks = []
        for ab in art.findall('.//Abstract/AbstractText'):
            label = ab.get('Label')
            txt = ''.join(ab.itertext()).strip()
            if txt:
                chunks.append(f'{label}: {txt}' if label else txt)
        abstract = '\n'.join(chunks).strip()
        # Authors
        authors = []
        for a in art.findall('.//AuthorList/Author'):
            ln = a.findtext('LastName') or ''
            fn = a.findtext('ForeName') or ''
            ini = a.findtext('Initials') or ''
            affil = a.findtext('.//AffiliationInfo/Affiliation') or a.findtext('.//Affiliation') or ''
            if ln:
                authors.append({'last': ln, 'fore': fn, 'initials': ini, 'affil': affil})
        year = (art.findtext('.//Journal/JournalIssue/PubDate/Year')
                or art.findtext('.//ArticleDate/Year') or '')
        out[pmid] = {'abstract': abstract, 'authors': authors, 'year': year}
    return out


def pubmed_efetch_details(pmids: list) -> dict:
    """efetch abstracts + author lists for a set of PMIDs."""
    if not pmids:
        return {}
    xml_text = _pubmed_get('efetch.fcgi', {'db': 'pubmed', 'id': ','.join(pmids), 'retmode': 'xml'},
                           parse_json=False)
    return _parse_pubmed_xml(xml_text)


def _author_index(authors: list, last: str, first: str) -> int | None:
    """Find this member among a paper's authors. Returns 0-based position or None."""
    last_l = (last or '').lower()
    fi = (first or '')[:1].lower()
    for i, a in enumerate(authors):
        if a['last'].lower() == last_l and (not fi or not a.get('initials') or a['initials'][:1].lower() == fi):
            return i
    return None


def _attribution_ok(authors: list, last: str, first: str, inst_tokens: list) -> bool:
    """For author-name search hits, only trust the match if the member appears
    in the author list AND their institution token shows up in that author's
    affiliation (guards against same-surname collisions)."""
    idx = _author_index(authors, last, first)
    if idx is None:
        return False
    affil = (authors[idx].get('affil') or '').lower()
    return any(tok in affil for tok in inst_tokens) if inst_tokens else False


# --- News / web search (Anthropic server-side web_search) -------------------

NEWS_SEARCH_SYSTEM = """You are a careful research assistant. You search the public web to find whether a SPECIFIC named physician has been featured, quoted, interviewed, or profiled in news/media in roughly the last 24 months.

You will be given the physician's name, specialty, and (sometimes) institution. Use web_search. Then decide:
- found=true ONLY if you locate a credible item (news article, interview, podcast feature, press release, institutional news, op-ed they wrote) that is CLEARLY about THIS person — the specialty and/or institution must match. A random same-name hit, a different specialty, or a patient/obituary by the same name does NOT count.
- found=false if you are not confident it is the same person, or you find only their journal papers (those are handled separately), directory listings, or social profiles.

Return ONLY a single JSON object, no commentary:
{"found": true/false, "url": "...", "outlet": "...", "date": "YYYY-MM or YYYY-MM-DD", "title": "...", "summary": "2-3 sentence factual summary of what the item says and the physician's role/quote in it"}
If found=false, return {"found": false}."""


def news_search_for_physician(first: str, last: str, specialty: str, institution_hint: str = '') -> dict | None:
    """Search the web for a recent news/media item about this physician.
    Returns a source dict {type:'news', ...} or None. Requires a working
    ANTHROPIC_API_KEY with web_search enabled."""
    who = f'Dr. {first} {last}, {specialty}'
    if institution_hint:
        who += f' (affiliated with {institution_hint})'
    user = (f'Find a recent (last ~24 months) news or media item about {who}. '
            f'Search a few phrasings of the name plus specialty/institution. '
            f'Then return the JSON object as instructed.')
    try:
        msg = _anthropic().messages.create(
            model='claude-sonnet-4-6',
            max_tokens=1200,
            system=NEWS_SEARCH_SYSTEM,
            tools=[{'type': 'web_search_20250305', 'name': 'web_search', 'max_uses': 4}],
            messages=[{'role': 'user', 'content': user}],
        )
    except Exception as e:
        log.warning(f'News web_search failed ({first} {last}): {type(e).__name__}: {str(e)[:140]}')
        return None
    text = ''.join(b.text for b in msg.content if getattr(b, 'type', '') == 'text')
    m = re.search(r'\{.*\}', text, re.DOTALL)
    if not m:
        return None
    try:
        obj = json.loads(m.group(0))
    except json.JSONDecodeError:
        return None
    if not obj.get('found') or not obj.get('url'):
        return None
    return {
        'type': 'news',
        'title': (obj.get('title') or '').strip(),
        'outlet': (obj.get('outlet') or '').strip(),
        'date': (obj.get('date') or '').strip(),
        'url': obj.get('url').strip(),
        'text': (obj.get('summary') or '').strip(),
        'authorship': 'sole',
    }


def find_own_work(first: str, last: str, specialty: str, email: str,
                  known_pub_titles: list, use_news: bool = True,
                  exclude_urls: set | None = None) -> list:
    """Locate this member's own substantive work — abstract-grounded publications
    (preferred) and/or a recent news/media item. Returns an ORDERED list of
    candidate source dicts (best first) so the caller can fall back to the next
    candidate if a draft is dropped. Empty list when nothing is confidently
    theirs (→ section omitted).

    Two gates applied to every candidate: a recency floor
    (OWNWORK_RECENCY_MONTHS) and a dedup set (`exclude_urls` — items already
    shared with this member, so we never repeat)."""
    exclude_urls = exclude_urls or set()
    inst_tokens = _institution_tokens(email)
    # --- A. Their own listed publications → PMIDs (attribution certain) ------
    title_pmids = []
    for t in (known_pub_titles or [])[:8]:
        pmid = pubmed_title_lookup(t)
        if pmid:
            title_pmids.append(pmid)
    # --- B. Author-name recent search (only if we can disambiguate) ----------
    author_pmids = pubmed_author_recent(last, first, inst_tokens, months=30)
    all_pmids = list(dict.fromkeys(title_pmids + author_pmids))
    pubs = []
    if all_pmids:
        summ = {p['pmid']: p for p in pubmed_fetch(all_pmids)}
        details = pubmed_efetch_details(all_pmids)
        for pmid in all_pmids:
            meta = summ.get(pmid)
            det = details.get(pmid, {})
            if not meta:
                continue
            trusted = pmid in title_pmids or _attribution_ok(
                det.get('authors', []), last, first, inst_tokens)
            if not trusted:
                continue
            authors = det.get('authors', [])
            idx = _author_index(authors, last, first)
            pubs.append({
                'type': 'publication',
                'title': meta['title'],
                'journal': meta['journal'],
                'date': meta.get('pubdate', ''),
                'year': det.get('year') or (meta.get('pubdate', '') or '')[:4],
                'url': meta['url'],
                'text': det.get('abstract', ''),
                'authorship': 'sole' if len(authors) <= 1 else 'co',
                'author_position': idx,
                'n_authors': len(authors),
                'has_abstract': bool(det.get('abstract')),
            })
    # Keep only abstract-grounded publications (a non-fabricated post needs the
    # abstract), within the recency window, and not already shared. Most-recent
    # first.
    pubs = [p for p in pubs if p['has_abstract']
            and p['url'] not in exclude_urls
            and _is_recent_enough(p.get('date') or p.get('year', ''))]
    pubs.sort(key=lambda p: -(int(p['year']) if str(p.get('year') or '').isdigit() else 0))
    best_pub = pubs[0] if pubs else None

    # --- C. News / media -----------------------------------------------------
    news = None
    if use_news:
        inst_hint = inst_tokens[0].title() if inst_tokens else ''
        news = news_search_for_physician(first, last, specialty, inst_hint)
        # Apply the same recency + dedup gates to news.
        if news and (news['url'] in exclude_urls or not _is_recent_enough(news.get('date', ''))):
            log.info(f'    news for {first} {last} dropped (stale or already shared): {news.get("date","?")}')
            news = None

    # --- Rank candidates (best first). Prefer the more recent of {best_pub,
    # news}; the other becomes a fallback if the leader's draft is dropped.
    # Remaining publications follow as further fallbacks.
    candidates = []
    news_year = 0
    if news:
        m = re.search(r'(20\d{2})', news.get('date', ''))
        news_year = int(m.group(1)) if m else 0
    pub_year = int(best_pub['year']) if best_pub and str(best_pub.get('year') or '').isdigit() else 0
    if news and best_pub:
        candidates = [news, best_pub] if news_year > pub_year else [best_pub, news]
    elif news:
        candidates = [news]
    candidates += [p for p in pubs if p is not best_pub]
    return candidates


# --- Ghostwriting (Roon post in the member's voice) -------------------------

GHOSTWRITE_SYSTEM = """You are ghostwriting a SHORT post that a verified physician would feel comfortable publishing under their own name on Roon (a private network for US physicians). The post is seeded into a weekly digest as a ready-to-edit draft about the physician's OWN recent work.

YOUR ROLE:
- Write in the PHYSICIAN's own first-person voice. Use "we"/"our" when they co-authored a paper with others; use "I"/"my" for a solo paper, an essay, or a news interview. NEVER write in the editor's or "Team Roon" voice.

HARD RULES:
1. Do NOT fabricate any clinical specifics, statistics, sample sizes, p-values, effect sizes, recommendations, patient details, or stances that are not present in the SOURCE TEXT provided. If it isn't in the source, you may not say they wrote or believe it.
2. Do NOT quote the title of their paper/article back verbatim, and never put it in quotation marks. Refer to the work in plain prose ("our recent work on…", "in a piece I wrote about…").
3. The post must be standalone — no "click here", no "in my paper", no "link below". It should read as a self-contained perspective that happens to draw on their work.
4. Surface the single most clinically interesting or debate-worthy point, and END with one genuine open question that invites peers to weigh in. Do NOT include a poll, poll options, or multiple-choice answers.
5. Roon URLs (if ever needed) use https://www.roon.com — but you should not need any URL in the post body.
6. Tone: a thoughtful peer talking to peers. Specific, not promotional. Don't sand off the edges of their actual finding/argument.

LENGTH: 110-170 words.

OUTPUT FORMAT: a single JSON object, no commentary before or after:
{"post": "<the draft post text, paragraphs separated by \\n\\n>"}
If the source text is too thin to ground a real post (e.g. only a title, no abstract or summary), return {"drop": true, "reason": "<short reason>"}."""


def ghostwrite_post(first: str, last: str, specialty: str, source: dict) -> dict | None:
    """Draft a Roon post in the member's voice from their own work.
    Returns {'post': str} or None (drop / error)."""
    src_text = (source.get('text') or '').strip()
    if len(src_text) < 60:
        return None  # too thin to ground a non-fabricated post
    if source['type'] == 'publication':
        src_kind = ('a journal article you co-authored' if source.get('authorship') == 'co'
                    else 'a journal article you authored')
        outlet = source.get('journal', '')
    else:
        src_kind = f"a {source.get('outlet','news')} piece featuring you"
        outlet = source.get('outlet', '')
    payload = {
        'physician_first': first,
        'physician_last': last,
        'physician_specialty': specialty,
        'source_kind': src_kind,
        'source_outlet': outlet,
        'source_title': source.get('title', ''),
        'source_text': src_text[:6000],
        'authorship': source.get('authorship', 'co'),
    }
    try:
        msg = _anthropic().messages.create(
            model='claude-sonnet-4-6',
            max_tokens=700,
            system=GHOSTWRITE_SYSTEM,
            messages=[{'role': 'user', 'content': json.dumps(payload, ensure_ascii=False)}],
        )
    except Exception as e:
        log.warning(f'Ghostwrite failed ({first} {last}): {type(e).__name__}: {str(e)[:140]}')
        return None
    text = ''.join(b.text for b in msg.content if getattr(b, 'type', '') == 'text')
    m = re.search(r'\{.*\}', text, re.DOTALL)
    if not m:
        return None
    try:
        obj = json.loads(m.group(0))
    except json.JSONDecodeError:
        return None
    if obj.get('drop') or not obj.get('post'):
        log.info(f'  ghostwrite dropped ({first} {last}): {obj.get("reason","no post")}')
        return None
    return {'post': obj['post'].strip()}


def _source_label(source: dict) -> str:
    """Human eyebrow line: 'Based on your recent paper in Blood' etc."""
    if source['type'] == 'publication':
        verb = 'co-authored paper' if source.get('authorship') == 'co' else 'paper'
        where = f' in {source["journal"]}' if source.get('journal') else ''
        return f'Based on your recent {verb}{where}'
    outlet = source.get('outlet', '')
    return f'Based on your feature in {outlet}' if outlet else 'Based on a recent feature about you'


def load_ownwork_cache() -> dict:
    if os.path.exists(OWNWORK_CACHE):
        try:
            return json.load(open(OWNWORK_CACHE))
        except Exception:
            return {}
    return {}


def save_ownwork_cache(cache: dict) -> None:
    os.makedirs(os.path.dirname(OWNWORK_CACHE), exist_ok=True)
    with open(OWNWORK_CACHE, 'w') as fh:
        json.dump(cache, fh, indent=2)


def build_own_work(fellows: list, profiles: dict, bios_pubs: dict,
                   refresh: bool = False, use_news: bool = True,
                   shared_links: dict | None = None) -> dict:
    """Per-member {user_id: {'source': {...}, 'draft': {'post': ...}}} or absent
    when nothing found. Cached with a 7-day TTL keyed by user_id. `shared_links`
    maps user_id → set(article urls) already sent to that member (dedup)."""
    cache = load_ownwork_cache()
    shared_links = shared_links or {}
    now = datetime.now(timezone.utc)
    out = {}
    for i, fellow in enumerate(fellows):
        # Persist progress periodically so an interrupted run (e.g. a task
        # timeout on a long cohort) doesn't discard everything computed so far.
        if i and i % 25 == 0:
            save_ownwork_cache(cache)
        uid = fellow['user_id']
        prof = profiles.get(uid, {})
        spec = prof.get('specialty', '')
        first, last, email = fellow['first_name'], fellow['last_name'], fellow['email']
        exclude = shared_links.get(uid, set())
        cached = cache.get(uid)
        if cached and not refresh:
            try:
                age = (now - datetime.fromisoformat(cached['updated_at'])).days
            except Exception:
                age = 999
            # Negative cache: a fresh "nothing found" is valid within the TTL —
            # skip the expensive PubMed/news + Haiku recheck so multi-pass runs
            # converge instead of re-litigating every empty member each time.
            if age < OWNWORK_TTL_DAYS and cached.get('source') is None and 'updated_at' in cached:
                log.info(f'  ownwork [cache:none] {first} {last}: nothing found')
                continue
            csrc = cached.get('source') or {}
            cached_url = csrc.get('url')
            cached_recent = _is_recent_enough(csrc.get('date') or csrc.get('year', '')) if csrc else False
            # Serve from cache only if still fresh, still within the recency
            # window, AND not already shared (else recompute to avoid a stale/repeat pick).
            if (age < OWNWORK_TTL_DAYS and cached.get('source') and cached.get('draft')
                    and cached_url not in exclude and cached_recent):
                out[uid] = {'source': cached['source'], 'draft': cached['draft']}
                log.info(f'  ownwork [cache] {first} {last}: {cached["source"]["type"]}')
                continue
        pub_titles = (bios_pubs.get(uid) or {}).get('pub_titles', [])
        candidates = find_own_work(first, last, spec, email, pub_titles,
                                   use_news=use_news, exclude_urls=exclude)
        if not candidates:
            log.info(f'  ownwork {first} {last}: nothing found → section omitted')
            cache[uid] = {'source': None, 'draft': None, 'updated_at': now.isoformat()}
            continue
        # Try candidates in rank order; fall back if a draft is dropped so a
        # thin/unusable leader never costs us a perfectly good grounded paper.
        chosen, draft = None, None
        for cand in candidates:
            d = ghostwrite_post(first, last, spec, cand)
            if d:
                chosen, draft = cand, d
                break
            log.info(f'    {first} {last}: candidate dropped ({cand["type"]} "{cand.get("title","")[:40]}") — trying next')
        if not draft:
            log.info(f'  ownwork {first} {last}: {len(candidates)} candidate(s) all dropped → omitted')
            cache[uid] = {'source': None, 'draft': None, 'updated_at': now.isoformat()}
            continue
        out[uid] = {'source': chosen, 'draft': draft}
        cache[uid] = {'source': chosen, 'draft': draft, 'updated_at': now.isoformat()}
        log.info(f'  ownwork {first} {last}: {chosen["type"]} — "{chosen.get("title","")[:50]}"')
    save_ownwork_cache(cache)
    return out


def fetch_pubmed_for_fellow(interests: list, specialty: str, days: int = 14, k: int = 3) -> list:
    """Build per-fellow PubMed candidate pool, then rank.

    Treats the specialty filter as a *boost* rather than a hard AND. Many fellows
    have cross-specialty research (e.g. an IM fellow publishing psychiatry work);
    a strict AND filters out the most personally-relevant high-impact papers.

    Strategy: pull from three candidate pools and merge them, then rank by
    high-impact journal first, recency second. Interests-only is included with
    a wider window so personally-relevant work isn't lost just because it
    doesn't mention the fellow's clinical-care specialty.
    """
    spec_term = SPECIALTY_PUBMED_TERMS.get(specialty)
    interests_term = ('(' + ' OR '.join(_quote_term(t) for t in interests[:6]) + ')') if interests else None

    pools = []  # list of (priority, pmid_list)

    if interests_term and spec_term:
        pools.append((0, pubmed_search(f'{interests_term} AND ({spec_term})', days=days, retmax=10)))
    if interests_term:
        pools.append((1, pubmed_search(interests_term, days=days * 2, retmax=10)))
    if spec_term:
        pools.append((2, pubmed_search(spec_term, days=days, retmax=10)))
    elif specialty and not interests_term:
        pools.append((2, pubmed_search(f'"{specialty}"', days=days, retmax=10)))

    # Track each PMID's *best* (lowest) pool priority for relevance scoring
    pmid_pool = {}
    for priority, pmids in pools:
        for pmid in pmids:
            if pmid not in pmid_pool or priority < pmid_pool[pmid]:
                pmid_pool[pmid] = priority

    if not pmid_pool:
        return []

    papers = pubmed_fetch(list(pmid_pool.keys())[:25])

    # Compute per-paper relevance: count of distinct interest terms appearing
    # in the title (case-insensitive substring). The interest list is already
    # specific enough (e.g. "esketamine", "psilocybin") that title-only is
    # plenty of signal — abstract scoring would need a second PubMed roundtrip.
    interest_lc = [t.lower() for t in (interests or [])]
    def interest_hits(title: str) -> int:
        t = (title or '').lower()
        return sum(1 for kw in interest_lc if kw in t)
    for p in papers:
        p['interest_hits'] = interest_hits(p['title'])

    # Rank order:
    #   1. high-impact journal (gates quality — we don't want a 3-keyword-hit
    #      paper from an obscure journal to outrank JAMA/NEJM)
    #   2. # of interest terms matched in title (more matches first)
    #   3. recency
    # Pool priority is used only as a final tiebreaker since the interest-hit
    # score already encodes most of what pool membership tells us.
    def sort_key(p):
        return (
            0 if p.get('high_impact') else 1,
            -p['interest_hits'],
            -_pubdate_sortable(p.get('pubdate', '')),
            pmid_pool.get(p['pmid'], 9),
        )
    papers.sort(key=sort_key)
    pool_summary = ', '.join(f'pool{i}={sum(1 for v in pmid_pool.values() if v == i)}' for i in range(3))
    log.info(f'    {len(papers)} candidates ({pool_summary}) → top {k}')
    time.sleep(0.15 if PUBMED_KEY else 0.4)
    return papers[:k]


_MONTHS = {m: i+1 for i, m in enumerate(['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'])}


def _pubdate_sortable(pubdate: str) -> int:
    """Convert "2026 May 6" or "2026 May" → sortable int yyyymmdd."""
    if not pubdate:
        return 0
    parts = pubdate.split()
    try:
        year = int(parts[0])
        month = _MONTHS.get(parts[1][:3], 0) if len(parts) > 1 else 0
        day = int(parts[2]) if len(parts) > 2 else 0
        return year * 10000 + month * 100 + day
    except (ValueError, IndexError):
        return 0


def fetch_pubmed_by_specialty(specialties: list) -> dict:
    """Deprecated: use fetch_pubmed_for_fellow per-fellow instead.
    Retained for specialty-only fallback group queries if ever needed."""
    out = {}
    for spec in set(s for s in specialties if s):
        term = SPECIALTY_PUBMED_TERMS.get(spec) or spec.split('&')[0].strip().lower()
        pmids = pubmed_search(term, days=14, retmax=15)
        if not pmids:
            out[spec] = []
            continue
        papers = pubmed_fetch(pmids)
        papers.sort(key=lambda p: (not p['high_impact'],))
        out[spec] = papers[:5]
        time.sleep(0.15 if PUBMED_KEY else 0.4)
    return out


# --- Notable new joiners ----------------------------------------------------

def fetch_notable_joiners(days: int = 14, limit: int = 40) -> list:
    """Recently-registered FULL users with signal of being 'notable' —
    has posted, has a populated bio, or at a notable institution."""
    q = f"""
    WITH new_users AS (
      SELECT u.id, u.first_name, u.last_name, u.display_name, u.bio, u.thumbnail, u.created_at,
        u.specialty_id, s.name AS specialty, s.subspecialty
      FROM `{BQ_PROJECT}.fixture_public.users_user` u
      JOIN `{BQ_PROJECT}.fixture_public.users_specialty` s ON u.specialty_id = s.id
      WHERE u.type='FULL' AND u.is_redeemed=TRUE
        AND u.created_at >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL {days} DAY)
    ),
    insts AS (
      SELECT w.user_id, inst.name AS institution,
        ROW_NUMBER() OVER (PARTITION BY w.user_id
          ORDER BY CASE WHEN w.end_year IS NULL THEN 0 ELSE 1 END, w.end_year DESC) AS rn
      FROM `{BQ_PROJECT}.fixture_public.users_workexperience` w
      JOIN `{BQ_PROJECT}.fixture_public.users_institution` inst ON w.institution_id = inst.id
      WHERE w.user_id IN (SELECT id FROM new_users)
    ),
    post_counts AS (
      SELECT author_id AS user_id, COUNT(*) AS total_posts
      FROM `{BQ_PROJECT}.fixture_public.feeds_post`
      WHERE is_active=TRUE AND author_id IN (SELECT id FROM new_users)
      GROUP BY author_id
    )
    SELECT nu.id, nu.first_name, nu.last_name, nu.display_name, nu.bio, nu.thumbnail, nu.created_at,
      nu.specialty, nu.subspecialty,
      i.institution,
      COALESCE(pc.total_posts, 0) AS total_posts
    FROM new_users nu
    LEFT JOIN insts i ON i.user_id = nu.id AND i.rn = 1
    LEFT JOIN post_counts pc ON pc.user_id = nu.id
    WHERE COALESCE(pc.total_posts, 0) > 0
       OR LENGTH(COALESCE(nu.bio, '')) > 30
       OR i.institution IS NOT NULL
    ORDER BY COALESCE(pc.total_posts, 0) DESC, nu.created_at DESC
    LIMIT {limit}
    """
    return bq(q, f'notable joiners last {days}d')


def pick_joiners_for(fellow_specialty: str, all_joiners: list, n: int = 3) -> list:
    """Prefer same-specialty joiners; fill with any remaining if short."""
    same = [j for j in all_joiners if (j.get('specialty') or '') == fellow_specialty]
    other = [j for j in all_joiners if (j.get('specialty') or '') != fellow_specialty]
    # Prefer joiners who have posted; then those with institution; then bio
    def score(j):
        return (int(j.get('total_posts') or 0), 1 if j.get('institution') else 0, 1 if j.get('bio') else 0)
    same.sort(key=score, reverse=True)
    other.sort(key=score, reverse=True)
    return (same + other)[:n]


# --- Classification + hype --------------------------------------------------

def classify(act7: dict) -> str:
    meaningful = act7['posts'] + act7['comments']
    if meaningful >= 3:
        return 'very'
    if meaningful >= 1 or act7['reactions'] >= 5:
        return 'medium'
    return 'inactive'


def hype_line(thread: dict) -> str | None:
    role = thread['role']
    reacts = int(thread['thread_reactions'] or 0)
    replies = int(thread['thread_replies'] or 0)
    new_replies = int(thread['new_replies_since'] or 0)
    if role == 'authored' and reacts >= 10:
        return f'Your post is taking off — {reacts} reactions and {replies} replies.'
    if role == 'authored' and reacts >= 5:
        return f'Your post is picking up — {reacts} reactions so far.'
    if role == 'authored' and replies >= 2:
        return f'Your post is generating discussion — {replies} physicians have weighed in.'
    if role == 'commented' and reacts >= 5:
        return f'This thread is active — {reacts} reactions across {replies} replies since your comment.'
    if role == 'commented' and new_replies >= 1:
        return f'{new_replies} new repl{"y" if new_replies == 1 else "ies"} since your comment.'
    return None


def intro_copy(state: str, first: str, act7: dict) -> str:
    if state == 'very':
        return (f'You had a strong week on Roon, Dr. [last]. Your posts and comments are generating real '
                f'discussion — other fellows and attendings are building on your ideas. '
                f'Here\'s what happened across your threads this week.')
    if state == 'medium':
        if act7['posts'] + act7['comments'] >= 1:
            return (f'You\'ve been in the conversation this week, Dr. [last]. Here\'s the state of your threads '
                    f'plus a few others picking up in your specialty that might be worth your take.')
        return (f'You\'ve been reading more than posting this week — we see you in the reactions. '
                f'Here\'s what\'s picking up that might be worth weighing in on.')
    # inactive
    return (f'Noticed it\'s been quiet on your end this week. No pressure at all — but if something\'s '
            f'not landing for you here (or life is just a lot right now), let us know. '
            f'We\'d love to know how we can help.')


# --- Render -----------------------------------------------------------------

TEAL = '#2F7483'
BG = '#f2edea'
TEXT = '#555555'


def render_stats_box(act7: dict, last_login: str) -> str:
    def stat(n, label, border_left=False, border_right=False):
        bl = 'border-left: 1px solid rgba(255,255,255,0.2);' if border_left else ''
        br = 'border-right: 1px solid rgba(255,255,255,0.2);' if border_right else ''
        # Fire emoji when count >= 2 (a real signal of engagement, not a one-off)
        fire = ' 🔥' if int(n) >= 2 else ''
        return (f'<td width="25%" style="text-align:center;padding:8px 0;{bl}{br}">'
                f'<p style="margin:0;color:#ffffff;font-family:Georgia,\'Times New Roman\',serif;font-size:32px;font-weight:700;">{n}{fire}</p>'
                f'<p style="margin:4px 0 0;color:rgba(255,255,255,0.7);font-family:Helvetica,Arial,sans-serif;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">{label}</p></td>')
    last_visit_html = ''
    if last_login:
        try:
            dt = datetime.fromisoformat(last_login.replace('Z', '+00:00'))
            last_visit_html = (f'<p style="margin:10px 0 0;color:rgba(255,255,255,0.6);font-family:Helvetica,Arial,sans-serif;'
                               f'font-size:11px;text-align:center;">Last visit · {dt.strftime("%b %-d")}</p>')
        except Exception:
            pass
    return f"""
  <tr><td style="padding:18px 30px 6px;text-align:center;">
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:{TEAL};border-radius:20px;">
      <tr><td style="padding:24px 20px 8px;text-align:center;">
        <p style="margin:0 0 16px 0;color:rgba(255,255,255,0.7);font-family:Helvetica,Arial,sans-serif;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;">Your Week at a Glance</p>
      </td></tr>
      <tr><td style="padding:0 20px 12px;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
          {stat(act7['posts'], 'Posts')}
          {stat(act7['comments'], 'Comments', border_left=True, border_right=True)}
          {stat(act7['rounds'], 'Rounds', border_right=True)}
          {stat(act7['reactions'], 'Reactions')}
        </tr></table>
        {last_visit_html}
      </td></tr>
    </table>
  </td></tr>
"""


def render_thread_card(post_id: str, title: str, byline: str, hype: str | None, url: str,
                       cta: str = 'Continue the conversation →') -> str:
    hype_html = ''
    if hype:
        hype_html = (f'<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:10px;">'
                     f'<tr><td style="background:#e8f3f0;border-radius:6px;padding:10px 14px;">'
                     f'<p style="margin:0;color:{TEAL};font-family:Helvetica,Arial,sans-serif;font-size:13px;font-weight:600;line-height:1.4;">'
                     f'{escape(hype)}</p></td></tr></table>')
    # Title is a real <a>, button is a real <a> — no outer anchor wrapping the table
    # (wrapping <a> around <table> is unreliable across Outlook/Gmail mobile)
    return f"""
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-bottom:1px solid #e0dcd6;">
    <tr><td style="padding:14px 0;">
      {hype_html}
      <p style="margin:0 0 4px;font-family:Helvetica,Arial,sans-serif;font-size:15px;font-weight:700;line-height:1.35;">
        <a href="{url}" style="color:#333;text-decoration:none;">{escape(title)}</a>
      </p>
      <p style="margin:0 0 12px;color:#999;font-family:Helvetica,Arial,sans-serif;font-size:12px;">{escape(byline)}</p>
      <table cellpadding="0" cellspacing="0" border="0"><tr>
        <td style="border:1.5px solid {TEAL};border-radius:6px;">
          <a href="{url}" style="display:inline-block;padding:8px 16px;color:{TEAL};font-family:Helvetica,Arial,sans-serif;font-size:13px;font-weight:600;text-decoration:none;line-height:1;">{escape(cta)}</a>
        </td>
      </tr></table>
    </td></tr>
  </table>
"""


def render_trending(items: list) -> str:
    inner = ''
    for it in items:
        title = truncate(it['post_text'], 90) or '(No text)'
        author = f"Dr. {it['first_name']} {it['last_name']}"
        reacts = int(it['reactions'] or 0)
        replies = int(it['replies'] or 0)
        initials = (it['first_name'][:1] + it['last_name'][:1]).upper()
        url = post_url(it['post_id'], it.get('post_type'))
        inner += f"""
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-bottom:1px solid #e0dcd6;">
          <tr><td style="padding:12px 0;">
            <p style="margin:0 0 6px;font-family:Helvetica,Arial,sans-serif;font-size:15px;font-weight:700;line-height:1.35;">
              <a href="{url}" style="color:#333;text-decoration:none;">{escape(title)}</a>
            </p>
            <table cellpadding="0" cellspacing="0" border="0" style="margin-bottom:10px;"><tr>
              <td style="vertical-align:middle;padding-right:8px;"><div style="width:28px;height:28px;border-radius:50%;background:#d4e8e4;text-align:center;line-height:28px;font-family:Helvetica,Arial,sans-serif;font-size:11px;font-weight:700;color:{TEAL};">{escape(initials)}</div></td>
              <td style="vertical-align:middle;"><p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:12px;"><span style="color:#333;font-weight:700;">{escape(author)}</span><span style="color:#999;"> · {replies} repl{"y" if replies == 1 else "ies"}, {reacts} reactions</span></p></td>
            </tr></table>
            <table cellpadding="0" cellspacing="0" border="0"><tr>
              <td style="border:1.5px solid {TEAL};border-radius:6px;">
                <a href="{url}" style="display:inline-block;padding:7px 14px;color:{TEAL};font-family:Helvetica,Arial,sans-serif;font-size:12px;font-weight:600;text-decoration:none;line-height:1;">Read on Roon →</a>
              </td>
            </tr></table>
          </td></tr>
        </table>
        """
    return inner


def render_research(papers: list, specialty: str) -> str:
    if not papers:
        return ''
    hero = papers[0]
    rest = papers[1:3]
    hero_angle = hero.get('angle') or 'Throw this to your colleagues — are you changing practice based on it?'
    # TODO: If Roon gets a real compose-with-prefilled-link route, swap this in.
    # For now link to the doctors home so the user lands somewhere real.
    share_url = ROON_DOCTORS_HOME
    hero_html = f"""
    <tr><td style="padding:10px 30px 0;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:{TEAL};border-radius:20px;margin-bottom:12px;">
        <tr><td style="padding:22px 24px 8px;">
          <table cellpadding="0" cellspacing="0" border="0"><tr>
            <td style="background:rgba(255,255,255,0.15);border-radius:4px;padding:3px 10px;">
              <p style="margin:0;color:#fff;font-family:Helvetica,Arial,sans-serif;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;">Post Idea · PubMed</p>
            </td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:4px 24px 8px;">
          <p style="margin:0;color:#fff;font-family:Georgia,'Times New Roman',serif;font-size:17px;font-weight:700;line-height:1.4;">{escape(hero['title'])}</p>
        </td></tr>
        <tr><td style="padding:4px 24px 10px;">
          <p style="margin:0;color:rgba(255,255,255,0.75);font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:1.5;"><em>{escape(hero['journal'])}</em> · {escape(hero['pubdate'])}</p>
        </td></tr>
        <tr><td style="padding:8px 24px 16px;">
          <table width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr><td style="background:rgba(255,255,255,0.12);border-radius:8px;padding:12px 14px;">
              <p style="margin:0 0 4px;color:rgba(255,255,255,0.65);font-family:Helvetica,Arial,sans-serif;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;">Your Post Angle</p>
              <p style="margin:0;color:#fff;font-family:Georgia,'Times New Roman',serif;font-size:14px;font-style:italic;line-height:1.5;">{escape(hero_angle)}</p>
            </td></tr>
          </table>
        </td></tr>
        <tr><td style="padding:0 24px 22px;">
          <table cellpadding="0" cellspacing="0" border="0"><tr>
            <td style="background:#fff;border-radius:160px;padding:9px 18px;">
              <a href="{share_url}" style="color:{TEAL};font-family:Helvetica,Arial,sans-serif;font-size:13px;font-weight:600;text-decoration:none;">Start a thread on Roon →</a>
            </td>
            <td width="10"></td>
            <td style="border:1px solid rgba(255,255,255,0.5);border-radius:160px;padding:9px 18px;">
              <a href="{hero['url']}" style="color:#fff;font-family:Helvetica,Arial,sans-serif;font-size:13px;text-decoration:none;">Read paper →</a>
            </td>
          </tr></table>
        </td></tr>
      </table>
    </td></tr>
    """
    list_html = ''
    for p in rest:
        angle = p.get('angle') or ''
        p_share = ROON_DOCTORS_HOME  # TODO: real compose route when available
        angle_html = (f'<p style="margin:4px 0 0;color:{TEAL};font-family:Georgia,\'Times New Roman\',serif;'
                      f'font-size:12px;font-style:italic;line-height:1.5;">{escape(angle)}</p>') if angle else ''
        list_html += f"""
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-bottom:1px solid #e0dcd6;">
      <tr><td style="padding:12px 0;">
        <table cellpadding="0" cellspacing="0" border="0"><tr>
          <td style="vertical-align:top;padding-right:10px;padding-top:2px;">
            <div style="background:#e8f3f0;border-radius:4px;padding:3px 8px;">
              <p style="margin:0;color:{TEAL};font-family:Helvetica,Arial,sans-serif;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">PubMed</p>
            </div>
          </td>
          <td>
            <p style="margin:0 0 3px;color:#333;font-family:Helvetica,Arial,sans-serif;font-size:14px;font-weight:700;line-height:1.35;"><a href="{p['url']}" style="color:#333;text-decoration:none;">{escape(p['title'])}</a></p>
            <p style="margin:0;color:#999;font-family:Helvetica,Arial,sans-serif;font-size:12px;"><em>{escape(p['journal'])}</em> · {escape(p['pubdate'])}</p>
            {angle_html}
            <p style="margin:6px 0 0;"><a href="{p_share}" style="color:{TEAL};font-family:Helvetica,Arial,sans-serif;font-size:11px;font-weight:600;text-decoration:none;">Share on Roon →</a></p>
          </td>
        </tr></table>
      </td></tr>
    </table>
"""
    return hero_html + (f'<tr><td style="padding:4px 40px 0;">{list_html}</td></tr>' if list_html else '')


def render_joiners(joiners: list) -> str:
    if not joiners:
        return ''
    rows = ''
    for j in joiners:
        name = f"Dr. {j['first_name']} {j['last_name']}"
        initials = (j['first_name'][:1] + j['last_name'][:1]).upper()
        spec = j.get('specialty', '') or ''
        inst = j.get('institution', '') or ''
        posted = int(j.get('total_posts') or 0)
        subline = ' · '.join([x for x in [spec, inst] if x])
        context = ''
        if posted > 0:
            context = f"Already posting — {posted} post{'s' if posted != 1 else ''} since joining"
        elif j.get('bio'):
            context = truncate(j['bio'], 90)
        prof = profile_url(j.get('display_name') or '')
        href = prof or ROON_DOCTORS_HOME
        rows += f"""
        <tr><td style="padding:12px 0;border-bottom:1px solid #e0dcd6;">
          <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
            <td width="44" valign="top">
              <a href="{href}" style="text-decoration:none;">
                <div style="width:40px;height:40px;border-radius:50%;background:#d4e8e4;text-align:center;line-height:40px;font-family:Helvetica,Arial,sans-serif;font-size:14px;font-weight:700;color:{TEAL};">{escape(initials)}</div>
              </a>
            </td>
            <td style="padding-left:12px;vertical-align:middle;">
              <p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:14px;font-weight:700;">
                <a href="{href}" style="color:#333;text-decoration:none;">{escape(name)}</a>
              </p>
              <p style="margin:2px 0 0;color:#999;font-family:Helvetica,Arial,sans-serif;font-size:12px;">{escape(subline)}</p>
              {f'<p style="margin:3px 0 0;color:{TEAL};font-family:Helvetica,Arial,sans-serif;font-size:11px;">{escape(context)}</p>' if context else ''}
            </td>
            <td width="90" align="right" valign="middle">
              <table cellpadding="0" cellspacing="0" border="0"><tr>
                <td style="border:1.5px solid {TEAL};border-radius:6px;">
                  <a href="{href}" style="display:inline-block;padding:7px 14px;color:{TEAL};font-family:Helvetica,Arial,sans-serif;font-size:12px;font-weight:600;text-decoration:none;line-height:1;">View profile</a>
                </td>
              </tr></table>
            </td>
          </tr></table>
        </td></tr>
"""
    return rows


def render_email(fellow: dict, profile: dict, act7: dict, state: str,
                 relevant_posts: list, specialty_trending: list,
                 own_work: dict, joiners: list) -> str:
    # Legacy (non-figma) layout — not used for live sends. Kept signature in
    # sync with render_email_figma; renders relevant_posts as its trending list.
    trending = (relevant_posts or []) + (specialty_trending or [])
    first = fellow['first_name']
    last = fellow['last_name']
    specialty = profile.get('specialty', '')
    last_login = profile.get('last_login', '')

    intro = intro_copy(state, first, act7).replace('[last]', last)

    # Avatar block — centered profile pic between header image and title.
    # Falls back to initials in a teal circle when no thumbnail.
    photo = photo_url(profile.get('thumbnail'))
    initials = (first[:1] + last[:1]).upper()
    if photo:
        avatar_html = (f'<img src="{photo}" alt="" width="72" height="72" '
                       f'style="display:block;width:72px;height:72px;border-radius:50%;'
                       f'border:3px solid #fff;box-shadow:0 0 0 1px #e0dcd6;'
                       f'object-fit:cover;margin:0 auto;">')
    else:
        avatar_html = (f'<div style="width:72px;height:72px;border-radius:50%;'
                       f'background:#d4e8e4;text-align:center;line-height:72px;'
                       f'font-family:Helvetica,Arial,sans-serif;font-size:24px;font-weight:700;'
                       f'color:{TEAL};margin:0 auto;border:3px solid #fff;'
                       f'box-shadow:0 0 0 1px #e0dcd6;">{escape(initials)}</div>')
    avatar_block = (f'<tr><td align="center" style="padding:24px 40px 0;">{avatar_html}</td></tr>')

    # NOTE: "Conversations You're In" section removed per Reviewer's design feedback (2026-04-27).
    # All three states (very/medium/inactive) now skip directly from intro+stats to research/trending.

    # Trending
    trending_html = render_trending(trending)

    # CTA label
    cta_label = {'very': 'Keep the momentum going', 'medium': 'Jump into a conversation', 'inactive': 'Take a look around'}[state]

    # Footer note — for inactive, softer + explicit reply prompt
    if state == 'inactive':
        note_html = f"""
    <tr><td style="padding:10px 40px 10px;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f7f5f2;border-radius:8px;">
        <tr><td style="padding:18px 24px;text-align:center;">
          <p style="margin:0 0 6px;color:#333;font-family:Helvetica,Arial,sans-serif;font-size:14px;font-weight:700;">One thing before you go</p>
          <p style="margin:0;color:{TEXT};font-family:Helvetica,Arial,sans-serif;font-size:13px;line-height:1.5;">Reply to this email with one line on what\'s getting in the way — missing content, clunky workflow, or just fellowship eating you alive. I read every one and it helps shape what we build.</p>
        </td></tr>
      </table>
    </td></tr>
"""
    else:
        note_html = f"""
    <tr><td style="padding:10px 40px 10px;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f7f5f2;border-radius:8px;">
        <tr><td style="padding:18px 24px;text-align:center;">
          <p style="margin:0 0 6px;color:#333;font-family:Helvetica,Arial,sans-serif;font-size:14px;font-weight:700;">Ideas for Roon? We\'re listening.</p>
          <p style="margin:0;color:{TEXT};font-family:Helvetica,Arial,sans-serif;font-size:13px;line-height:1.5;">As a member of the Fellows Council, your input shapes what we build. Reply to this email anytime.</p>
        </td></tr>
      </table>
    </td></tr>
"""

    week_of = datetime.now(timezone.utc).strftime('%B %-d, %Y')

    # "Worth posting on Roon" — AI-drafted post from the member's own work.
    if own_work and own_work.get('draft'):
        research_section = f"""
  <tr><td style="padding:36px 40px 0;">
    <table cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="background:{TEAL};width:36px;height:3px;line-height:3px;font-size:0;">&nbsp;</td>
    </tr></table>
    <h2 style="margin:10px 0 0;color:#222;font-family:Georgia,'Times New Roman',serif;font-size:22px;font-weight:700;line-height:1.25;letter-spacing:-0.2px;">Worth posting on Roon</h2>
    <p style="margin:6px 0 0;color:#999;font-family:Helvetica,Arial,sans-serif;font-size:13px;line-height:1.5;">We drafted this from your recent work — make it yours.</p>
  </td></tr>
  <tr><td style="padding:10px 40px 0;">{render_own_work_figma(own_work['draft'], own_work['source'])}</td></tr>
"""
    else:
        research_section = ''

    # Notable joiners
    if joiners:
        joiners_rows = render_joiners(joiners)
        joiners_section = f"""
  <tr><td style="padding:36px 40px 0;">
    <table cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="background:{TEAL};width:36px;height:3px;line-height:3px;font-size:0;">&nbsp;</td>
    </tr></table>
    <h2 style="margin:10px 0 0;color:#222;font-family:Georgia,'Times New Roman',serif;font-size:22px;font-weight:700;line-height:1.25;letter-spacing:-0.2px;">Notable Physicians Who Just Joined</h2>
    <p style="margin:6px 0 0;color:#999;font-family:Helvetica,Arial,sans-serif;font-size:13px;line-height:1.5;">New on Roon in the last two weeks — worth a follow.</p>
  </td></tr>
  <tr><td style="padding:10px 40px 0;"><table width="100%" cellpadding="0" cellspacing="0" border="0">{joiners_rows}</table></td></tr>
"""
    else:
        joiners_section = ''

    html = f"""<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>* {{ box-sizing:border-box; }} body {{ margin:0; padding:0; }} a {{ text-decoration:none; }}</style>
</head>
<body style="background-color:{BG};margin:0;padding:0;">
<div style="display:none;max-height:0;overflow:hidden;">Your Fellows Council weekly digest — what happened on Roon this week.</div>
<table width="100%" border="0" cellpadding="0" cellspacing="0" style="background-color:{BG};">
<tr><td align="center">
<table width="750" cellpadding="0" cellspacing="0" border="0" style="background-color:{BG};max-width:750px;width:100%;margin:0 auto;">

  <tr><td style="padding:0;"><img src="{HEADER_IMG}" style="display:block;height:auto;border:0;width:100%;" width="750" alt="Roon"></td></tr>

  {avatar_block}

  <tr><td style="padding:14px 40px 4px;text-align:center;">
    <h1 style="margin:0;color:#333;font-family:Georgia,'Times New Roman',serif;font-size:24px;font-weight:700;line-height:1.3;">Dr. {escape(last)}’s Fellows Council Weekly</h1>
  </td></tr>
  <tr><td style="padding:6px 40px 4px;text-align:center;">
    <p style="margin:0;color:#999;font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:1.5;">Your personalized digest · Week of {week_of}</p>
  </td></tr>
  <tr><td style="padding:6px 40px 6px;text-align:center;">
    <p style="margin:0;color:#bbb;font-family:Helvetica,Arial,sans-serif;font-size:10px;letter-spacing:0.5px;text-transform:uppercase;">Where doctors discuss what matters</p>
  </td></tr>

  <tr><td style="padding:14px 40px 6px;text-align:left;">
    <p style="margin:0;color:{TEXT};font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;">{escape(intro)}</p>
  </td></tr>

  {render_stats_box(act7, last_login)}

  <tr><td style="padding:36px 40px 0;">
    <table cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="background:{TEAL};width:36px;height:3px;line-height:3px;font-size:0;">&nbsp;</td>
    </tr></table>
    <h2 style="margin:10px 0 0;color:#222;font-family:Georgia,'Times New Roman',serif;font-size:22px;font-weight:700;line-height:1.25;letter-spacing:-0.2px;">Trending Across Roon</h2>
  </td></tr>
  <tr><td style="padding:10px 40px 0;">{trending_html}</td></tr>

  {research_section}

  {joiners_section}

  <tr><td align="center" style="padding:24px 40px 10px;">
    <table cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;"><tr>
      <td align="center" style="background-color:{TEAL};border-radius:8px;padding:14px 40px;">
        <a href="{ROON_DOCTORS_HOME}" style="color:#fff;font-family:Helvetica,Arial,sans-serif;font-size:15px;font-weight:600;display:inline-block;">{escape(cta_label)} →</a>
      </td></tr></table>
  </td></tr>

  {note_html}

  <tr><td align="center" style="padding:22px 40px 32px;">
    <p style="margin:0;color:#999;font-family:Helvetica,Arial,sans-serif;font-size:11px;line-height:1.6;">You\'re receiving this as a member of the Roon Fellows Council.</p>
    <p style="margin:10px 0 0;color:{TEXT};font-family:Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;">— Team Roon</p>
    <p style="margin:12px 0 0;font-family:Helvetica,Arial,sans-serif;font-size:11px;">
      <a href="#" style="color:#999;">Email preferences</a> &nbsp;·&nbsp; <a href="#" style="color:#999;">Unsubscribe</a>
    </p>
  </td></tr>

</table></td></tr></table></body></html>
"""
    return html


# --- Figma-matched render ---------------------------------------------------
#
# New visual system from `Roon Email Template System` Figma file
# (node 49:1218 — "Fellow & Hypernode - weekly"). One integrated teal hero
# (logo + avatar + title + vol/week + stats), two Trending blocks bracketing
# the PubMed hero, Notable Physicians with affinity badges, teal pill CTA,
# simplified footer.

TEAL_DARK = '#1F5A66'   # hero gradient bottom
TEAL_LIGHT = '#3A8294'  # hero gradient top accent (approximated)
CARD_TEAL = '#2F7483'   # inner stats card
CARD_BG = '#ffffff'
CARD_BORDER = '#eae6e1'

# Streak banner palette (warm "fire" amber on-streak; neutral for the off state)
STREAK_AMBER_BG = '#fff7ed'
STREAK_AMBER_BORDER = '#f4d6a6'
STREAK_AMBER_DEEP = '#9a3412'
STREAK_AMBER_MID = '#c2410c'
STREAK_AMBER_PIP = '#f97316'
STREAK_NEUTRAL_BG = '#f3f1ee'
STREAK_NEUTRAL_BORDER = '#e2ddd6'
STREAK_NEUTRAL_TEXT = '#5a6266'
STREAK_PIP_EMPTY = '#e7e2da'


def render_streak_pips(n: int) -> str:
    """A 10-segment progress row toward the milestone (email-safe table)."""
    filled = max(0, min(n, STREAK_MILESTONE))
    cells = []
    for i in range(STREAK_MILESTONE):
        color = STREAK_AMBER_PIP if i < filled else STREAK_PIP_EMPTY
        cells.append(f'<td style="padding:0 2px;"><div style="height:7px;border-radius:4px;'
                     f'background:{color};"></div></td>')
    return ('<table width="100%" cellpadding="0" cellspacing="0" border="0" '
            'style="margin:14px 0 0;"><tr>' + ''.join(cells) + '</tr></table>')


def render_streak_banner(last: str, n: int) -> str:
    """'Your Roon Streak' banner that leads the email. 🔥 + number when on a
    streak (>=1 week of >=1 post AND >=1 comment), neutral start-state when not.
    Calc explained below the number; 10-week milestone (feature + special gift)
    + the experiment note. Greeting uses the surname, matching the hero."""
    s = '' if n == 1 else 's'
    dr = f'Dr. {escape(last)}'
    if n >= 1:
        bg, border, deep, mid = (STREAK_AMBER_BG, STREAK_AMBER_BORDER,
                                 STREAK_AMBER_DEEP, STREAK_AMBER_MID)
        number_row = (
            f'<span style="font-size:40px;vertical-align:middle;">&#x1F525;</span>'
            f'<span style="font-size:50px;font-weight:700;color:{deep};vertical-align:middle;'
            f'font-family:Georgia,\'Times New Roman\',serif;letter-spacing:-1px;">&nbsp;{n}&nbsp;</span>'
            f'<span style="font-size:18px;color:{deep};vertical-align:middle;'
            f'font-family:Georgia,\'Times New Roman\',serif;">week{s}</span>')
        headline = f"{n} week{s} running, {dr} &mdash; keep it going."
        if n >= STREAK_MILESTONE:
            milestone = (f"&#x1F389; {STREAK_MILESTONE} weeks! We&rsquo;ll feature you and "
                         "send a special gift.")
        else:
            left = STREAK_MILESTONE - n
            milestone = (f"<b>{left} more week{'' if left == 1 else 's'}</b> to a "
                         f"{STREAK_MILESTONE}-week streak: a feature + a special gift.")
    else:
        bg, border, deep, mid = (STREAK_NEUTRAL_BG, STREAK_NEUTRAL_BORDER,
                                 '#2b3438', STREAK_NEUTRAL_TEXT)
        number_row = (f'<span style="font-size:30px;font-weight:700;color:{deep};'
                      f'font-family:Georgia,\'Times New Roman\',serif;">Start your streak</span>')
        headline = (f"No streak yet, {dr} &mdash; post once and comment once this week to start one.")
        milestone = f"Hit a {STREAK_MILESTONE}-week streak for a feature + a special gift."

    return f"""
  <tr><td style="padding:20px 30px 0;">
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:{bg};border:1px solid {border};border-radius:16px;">
      <tr><td style="padding:22px 26px 24px;text-align:center;">
        <p style="margin:0;color:{mid};font-family:Helvetica,Arial,sans-serif;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:2px;">Your Roon Streak</p>
        <p style="margin:12px 0 0;line-height:1;">{number_row}</p>
        <p style="margin:14px 6px 0;color:{deep};font-family:Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;">{headline}</p>
        <p style="margin:10px 6px 0;color:{mid};font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:1.5;"><b>1 post + 1 comment</b> each week keeps it alive. Miss one and it resets.</p>
        {render_streak_pips(n)}
        <p style="margin:12px 6px 0;color:{mid};font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:1.5;">{milestone}</p>
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:18px 0 0;"><tr><td style="border-top:1px solid {border};font-size:0;line-height:0;">&nbsp;</td></tr></table>
        <p style="margin:14px 6px 0;color:{mid};font-family:Helvetica,Arial,sans-serif;font-size:11px;line-height:1.55;font-style:italic;">We&rsquo;re experimenting with streaks &mdash; an idea proposed by one of our founding community members, and hopefully a bit of fun in this weekly email. Let us know what you think!</p>
      </td></tr>
    </table>
  </td></tr>
"""

# Sanitized brand wordmark used by the offline acceptance fixture.
# Light variant for use on the dark teal hero. Native 106x22; rendered at
# 96px wide so retina screens get crisp scaling.
ROON_WORDMARK_URL = 'https://assets.example.test/wordmark.png'
ROON_WORDMARK_W = 96
ROON_WORDMARK_H = 20


def _specialty_plural_phrase(specialty: str) -> str:
    """Render an affinity badge phrase. The Figma shows "You're both Cardiologists"
    but pluralizing every specialty cleanly is brittle (Pediatrics → Pediatricians,
    Internal Medicine → Internists, etc.). Use a safer construction."""
    if not specialty:
        return ''
    return f"You're both in {specialty}"


def affinity_badges(joiner: dict, fellow_specialty: str) -> list:
    """Return list of badge strings to render next to a joiner."""
    badges = []
    j_spec = (joiner.get('specialty') or '').strip()
    if j_spec and fellow_specialty and j_spec.lower() == fellow_specialty.lower():
        badges.append(_specialty_plural_phrase(j_spec))
    # "Just joined" badge — surfaces recency
    created = joiner.get('created_at')
    if created:
        try:
            dt = datetime.fromisoformat(str(created).replace('Z', '+00:00'))
            delta_days = (datetime.now(timezone.utc) - dt).days
            if delta_days < 0:
                pass
            elif delta_days == 0:
                badges.append('Just joined today')
            elif delta_days < 14:
                badges.append(f'Joined {delta_days}d ago')
        except Exception:
            pass
    return badges


def render_reached_figma(reached) -> str:
    """Headline 'Physician views' — cumulative all-time impressions on the
    member's content. The hero centerpiece. Hidden if we have no view data."""
    if not reached:
        return ''
    return f"""
      <tr><td style="padding:6px 40px 0;text-align:center;">
        <p style="margin:0;color:#ffffff;font-family:Georgia,'Times New Roman',serif;font-size:15px;line-height:1.3;">
          <span style="font-size:34px;font-weight:700;letter-spacing:-0.6px;vertical-align:middle;">{reached:,}</span>
          <span style="color:rgba(255,255,255,0.82);font-family:Helvetica,Arial,sans-serif;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;vertical-align:middle;">&nbsp;&nbsp;physician views</span>
        </p>
      </td></tr>
"""


def render_hero_figma(fellow: dict, profile: dict, act7: dict, state: str) -> str:
    """Integrated teal hero: Roon wordmark + avatar + title + week metadata +
    'Physicians reached' headline + 'Your Week at a Glance' stats card + tagline."""
    first = fellow['first_name']
    last = fellow['last_name']

    photo = photo_url(profile.get('thumbnail'))
    initials = (first[:1] + last[:1]).upper()
    if photo:
        avatar_html = (f'<img src="{photo}" alt="" width="60" height="60" '
                       f'style="display:block;width:60px;height:60px;border-radius:50%;'
                       f'border:2px solid rgba(255,255,255,0.85);object-fit:cover;margin:0 auto;">')
    else:
        avatar_html = (f'<div style="width:60px;height:60px;border-radius:50%;'
                       f'background:rgba(255,255,255,0.18);text-align:center;line-height:60px;'
                       f'font-family:Helvetica,Arial,sans-serif;font-size:22px;font-weight:700;'
                       f'color:#fff;margin:0 auto;border:2px solid rgba(255,255,255,0.85);">'
                       f'{escape(initials)}</div>')

    now = datetime.now(timezone.utc)
    iso_week = now.isocalendar().week
    published = now.strftime('%m/%d/%Y')
    week_of = now.strftime('%B %-d, %Y')

    # Stats cells with thin dividers between them
    def stat(n, label, left_border=False):
        bl = ('border-left:1px solid rgba(255,255,255,0.22);' if left_border else '')
        return (f'<td width="25%" style="text-align:center;padding:10px 4px;{bl}">'
                f'<p style="margin:0;color:#ffffff;font-family:Georgia,\'Times New Roman\',serif;'
                f'font-size:28px;font-weight:700;line-height:1;letter-spacing:-0.5px;">{n}</p>'
                f'<p style="margin:6px 0 0;color:rgba(255,255,255,0.72);font-family:Helvetica,Arial,sans-serif;'
                f'font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1.2px;">{label}</p></td>')

    tagline = intro_copy(state, first, act7).replace('[last]', last)

    return f"""
  <tr><td style="padding:0;">
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:{TEAL_DARK};background-image:linear-gradient(160deg,{TEAL_LIGHT} 0%,{TEAL_DARK} 70%);">
      <tr><td style="padding:26px 40px 6px;text-align:center;">
        <img src="{ROON_WORDMARK_URL}" width="{ROON_WORDMARK_W}" height="{ROON_WORDMARK_H}" alt="Roon" style="display:block;margin:0 auto;border:0;width:{ROON_WORDMARK_W}px;height:{ROON_WORDMARK_H}px;">
      </td></tr>
      <tr><td style="padding:12px 40px 0;text-align:center;">{avatar_html}</td></tr>
      <tr><td style="padding:10px 40px 0;text-align:center;">
        <h1 style="margin:0;color:#ffffff;font-family:Georgia,'Times New Roman',serif;font-size:24px;font-weight:700;line-height:1.2;letter-spacing:-0.3px;">Dr. {escape(last)}'s {escape(BRAND['weekly_title'])}</h1>
      </td></tr>
      <tr><td style="padding:6px 40px 0;text-align:center;">
        <p style="margin:0;color:rgba(255,255,255,0.6);font-family:Helvetica,Arial,sans-serif;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;">Vol {iso_week} &nbsp;·&nbsp; Week of {week_of}</p>
      </td></tr>

      {render_reached_figma(profile.get('reached'))}

      <tr><td style="padding:16px 30px 22px;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:{CARD_TEAL};border-radius:16px;">
          <tr><td style="padding:13px 12px 2px;text-align:center;">
            <p style="margin:0;color:rgba(255,255,255,0.72);font-family:Helvetica,Arial,sans-serif;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:2px;">Your Week at a Glance</p>
          </td></tr>
          <tr><td style="padding:2px 12px 13px;">
            <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
              {stat(act7['posts'], 'Posts')}
              {stat(act7['comments'], 'Comments', left_border=True)}
              {stat(act7['rounds'], 'Rounds', left_border=True)}
              {stat(act7['reactions'], 'Reactions', left_border=True)}
            </tr></table>
          </td></tr>
        </table>
        <p style="margin:14px 6px 0;color:rgba(255,255,255,0.88);font-family:Helvetica,Arial,sans-serif;font-size:13px;line-height:1.5;text-align:center;">{escape(tagline)}</p>
      </td></tr>
    </table>
  </td></tr>
"""


def render_section_header_figma(title: str, subtitle: str = '') -> str:
    sub_html = (f'<p style="margin:6px 0 0;color:#7a8a8e;font-family:Helvetica,Arial,sans-serif;'
                f'font-size:13px;line-height:1.5;">{escape(subtitle)}</p>' if subtitle else '')
    return f"""
  <tr><td style="padding:34px 40px 6px;">
    <h2 style="margin:0;color:#1c2326;font-family:Georgia,'Times New Roman',serif;font-size:22px;font-weight:700;line-height:1.25;letter-spacing:-0.2px;">{escape(title)}</h2>
    {sub_html}
  </td></tr>
"""


def render_trending_card_figma(it: dict) -> str:
    """White card on cream bg — avatar+name row at top, post text, meta footer
    + Read on Roon pill button. Matches Figma trending card style."""
    title = truncate(it['post_text'], 120) or '(No text)'  # truncate() strips mentions
    author = f"Dr. {it['first_name']} {it['last_name']}"
    spec = it.get('specialty', '') or ''
    reacts = int(it['reactions'] or 0)
    replies = int(it['replies'] or 0)
    initials = (it['first_name'][:1] + it['last_name'][:1]).upper()
    url = post_url(it['post_id'], it.get('post_type'))
    photo = photo_url(it.get('thumbnail'))
    if photo:
        avatar_html = (f'<img src="{photo}" alt="" width="34" height="34" '
                       f'style="display:block;width:34px;height:34px;border-radius:50%;object-fit:cover;">')
    else:
        avatar_html = (f'<div style="width:34px;height:34px;border-radius:50%;background:#d4e8e4;'
                       f'text-align:center;line-height:34px;font-family:Helvetica,Arial,sans-serif;'
                       f'font-size:12px;font-weight:700;color:{CARD_TEAL};">{escape(initials)}</div>')
    return f"""
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:{CARD_BG};border:1px solid {CARD_BORDER};border-radius:14px;margin-bottom:12px;">
      <tr><td style="padding:18px 20px 14px;">
        <table cellpadding="0" cellspacing="0" border="0" style="margin-bottom:10px;"><tr>
          <td valign="middle" style="padding-right:10px;">
            {avatar_html}
          </td>
          <td valign="middle">
            <p style="margin:0;color:#1c2326;font-family:Helvetica,Arial,sans-serif;font-size:13px;font-weight:700;line-height:1.2;">{escape(author)}</p>
            <p style="margin:2px 0 0;color:#8a949a;font-family:Helvetica,Arial,sans-serif;font-size:11px;">{escape(spec)}</p>
          </td>
        </tr></table>
        <p style="margin:0 0 14px;color:#2b3438;font-family:Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;">
          <a href="{url}" style="color:#2b3438;text-decoration:none;">{escape(title)}</a>
        </p>
        <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
          <td valign="middle">
            <p style="margin:0;color:#8a949a;font-family:Helvetica,Arial,sans-serif;font-size:12px;">
              <span>&#x1F44D; {reacts} Likes</span> &nbsp;&nbsp;
              <span>&#x1F4AC; {replies} Repl{"y" if replies == 1 else "ies"}</span>
            </p>
          </td>
          <td align="right" valign="middle">
            <table cellpadding="0" cellspacing="0" border="0"><tr>
              <td style="background:{CARD_TEAL};border-radius:160px;">
                <a href="{url}" style="display:inline-block;padding:7px 14px;color:#fff;font-family:Helvetica,Arial,sans-serif;font-size:12px;font-weight:600;text-decoration:none;line-height:1;">Join the discussion &nbsp;&#x2192;</a>
              </td>
            </tr></table>
          </td>
        </tr></table>
      </td></tr>
    </table>
"""


def render_trending_block_figma(items: list) -> str:
    return ''.join(render_trending_card_figma(it) for it in items)


def render_research_figma(papers: list, specialty: str) -> str:
    """PubMed hero card matching Figma — solid teal background, journal/date
    eyebrow, headline title, Read article + Start a thread buttons."""
    if not papers:
        return ''
    hero = papers[0]
    angle = hero.get('angle') or 'Bring this to your Roon network — what do they think?'
    share_url = ROON_DOCTORS_HOME
    journal_line = f"{hero.get('journal','')} · {hero.get('pubdate','')}".strip(' ·')
    return f"""
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:{CARD_TEAL};border-radius:18px;margin-bottom:14px;">
      <tr><td style="padding:24px 26px 4px;">
        <p style="margin:0;color:rgba(255,255,255,0.75);font-family:Helvetica,Arial,sans-serif;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;">{escape(journal_line)}</p>
      </td></tr>
      <tr><td style="padding:8px 26px 6px;">
        <p style="margin:0;color:#ffffff;font-family:Georgia,'Times New Roman',serif;font-size:20px;font-weight:700;line-height:1.3;letter-spacing:-0.3px;">
          <a href="{hero['url']}" style="color:#ffffff;text-decoration:none;">{escape(hero['title'])}</a>
        </p>
      </td></tr>
      <tr><td style="padding:10px 26px 4px;">
        <p style="margin:0;color:rgba(255,255,255,0.85);font-family:Georgia,'Times New Roman',serif;font-size:14px;font-style:italic;line-height:1.55;">&ldquo;{escape(angle)}&rdquo;</p>
      </td></tr>
      <tr><td style="padding:18px 26px 24px;">
        <table cellpadding="0" cellspacing="0" border="0"><tr>
          <td style="background:#ffffff;border-radius:160px;">
            <a href="{hero['url']}" style="display:inline-block;padding:10px 20px;color:{CARD_TEAL};font-family:Helvetica,Arial,sans-serif;font-size:13px;font-weight:600;text-decoration:none;line-height:1;">Read article</a>
          </td>
          <td width="10"></td>
          <td style="border:1px solid rgba(255,255,255,0.6);border-radius:160px;">
            <a href="{share_url}" style="display:inline-block;padding:10px 20px;color:#ffffff;font-family:Helvetica,Arial,sans-serif;font-size:13px;font-weight:600;text-decoration:none;line-height:1;">Start a thread &#x2192;</a>
          </td>
        </tr></table>
      </td></tr>
    </table>
"""


def render_own_work_figma(draft: dict, source: dict) -> str:
    """'Worth posting on Roon' card — an AI-drafted post in the member's voice,
    grounded in their own recent paper or news feature, with an edit disclaimer.
    No poll (by design). Source link + a compose-fallback CTA."""
    if not draft or not draft.get('post'):
        return ''
    eyebrow = _source_label(source)
    # Post body — split on blank lines into paragraphs
    paras = [p.strip() for p in re.split(r'\n\s*\n', draft['post'].strip()) if p.strip()]
    body_html = ''.join(
        f'<p style="margin:0 0 12px;color:#1c2326;font-family:Georgia,\'Times New Roman\',serif;'
        f'font-size:15px;line-height:1.62;">{escape(p)}</p>'
        for p in paras)
    source_url = source.get('url', ROON_DOCTORS_HOME)
    read_label = 'Read the article' if source['type'] == 'news' else 'Read the paper'
    return f"""
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;border:1px solid #e5e1da;border-radius:18px;margin-bottom:14px;">
      <tr><td style="padding:22px 26px 0;">
        <p style="margin:0;color:{CARD_TEAL};font-family:Helvetica,Arial,sans-serif;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;">{escape(eyebrow)}</p>
      </td></tr>
      <tr><td style="padding:14px 26px 4px;">
        {body_html}
      </td></tr>
      <tr><td style="padding:2px 26px 14px;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr><td style="background:#fbf6ec;border:1px solid #ecdfc4;border-radius:10px;padding:11px 14px;">
            <p style="margin:0;color:#8a6d2f;font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:1.5;">
              &#9999;&#65039; <strong>This is an AI-generated draft</strong> based on your recent work. Copy the text, paste into Roon, and give it a quick edit so it sounds like you &rarr; then post!
            </p>
          </td></tr>
        </table>
      </td></tr>
      <tr><td style="padding:0 26px 24px;">
        <table cellpadding="0" cellspacing="0" border="0"><tr>
          <td style="background:{CARD_TEAL};border-radius:160px;">
            <a href="{ROON_DOCTORS_HOME}" style="display:inline-block;padding:10px 20px;color:#ffffff;font-family:Helvetica,Arial,sans-serif;font-size:13px;font-weight:600;text-decoration:none;line-height:1;">Post this on Roon &#x2192;</a>
          </td>
          <td width="10"></td>
          <td style="border:1px solid {CARD_TEAL};border-radius:160px;">
            <a href="{source_url}" style="display:inline-block;padding:10px 20px;color:{CARD_TEAL};font-family:Helvetica,Arial,sans-serif;font-size:13px;font-weight:600;text-decoration:none;line-height:1;">{read_label} &#x2192;</a>
          </td>
        </tr></table>
      </td></tr>
    </table>
"""


def render_joiners_figma(joiners: list, fellow_specialty: str) -> str:
    """Notable joiners list with affinity badges (Figma style)."""
    if not joiners:
        return ''
    rows = ''
    for j in joiners:
        name = f"Dr. {j['first_name']} {j['last_name']}"
        initials = (j['first_name'][:1] + j['last_name'][:1]).upper()
        spec = j.get('specialty', '') or ''
        inst = j.get('institution', '') or ''
        subline = ' · '.join([x for x in [spec, inst] if x])
        prof = profile_url(j.get('display_name') or '')
        href = prof or ROON_DOCTORS_HOME
        badges = affinity_badges(j, fellow_specialty)
        badge_html = ''
        for b in badges:
            badge_html += (f'<span style="display:inline-block;background:#eef3f4;color:#4a6066;'
                           f'font-family:Helvetica,Arial,sans-serif;font-size:11px;font-weight:600;'
                           f'padding:3px 9px;border-radius:160px;margin-right:6px;margin-top:4px;">'
                           f'{escape(b)}</span>')
        avatar = ''
        photo = photo_url(j.get('thumbnail'))
        if photo:
            avatar = (f'<img src="{photo}" alt="" width="42" height="42" '
                      f'style="display:block;width:42px;height:42px;border-radius:50%;object-fit:cover;">')
        else:
            avatar = (f'<div style="width:42px;height:42px;border-radius:50%;background:#d4e8e4;text-align:center;'
                      f'line-height:42px;font-family:Helvetica,Arial,sans-serif;font-size:14px;font-weight:700;'
                      f'color:{CARD_TEAL};">{escape(initials)}</div>')
        rows += f"""
        <tr><td style="padding:14px 0;border-bottom:1px solid {CARD_BORDER};">
          <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
            <td width="52" valign="top">
              <a href="{href}" style="text-decoration:none;">{avatar}</a>
            </td>
            <td valign="middle" style="padding-left:8px;">
              <p style="margin:0;font-family:Helvetica,Arial,sans-serif;font-size:14px;font-weight:700;">
                <a href="{href}" style="color:#1c2326;text-decoration:none;">{escape(name)}</a>
              </p>
              <p style="margin:3px 0 0;color:#8a949a;font-family:Helvetica,Arial,sans-serif;font-size:12px;">{escape(subline)}</p>
              {badge_html}
            </td>
            <td width="100" align="right" valign="middle">
              <table cellpadding="0" cellspacing="0" border="0"><tr>
                <td style="background:{CARD_TEAL};border-radius:160px;">
                  <a href="{href}" style="display:inline-block;padding:8px 16px;color:#fff;font-family:Helvetica,Arial,sans-serif;font-size:12px;font-weight:600;text-decoration:none;line-height:1;">View profile</a>
                </td>
              </tr></table>
            </td>
          </tr></table>
        </td></tr>
"""
    return rows


def render_email_figma(fellow: dict, profile: dict, act7: dict, state: str,
                       relevant_posts: list, specialty_trending: list,
                       own_work: dict, joiners: list, streak: int = None) -> str:
    """Figma "Fellow & Hypernode - weekly" template — optional streak banner at
    the very top, then compact teal hero (stats + inline physician-views), then:
    Kick off a conversation (AI-drafted own-work post, leads under the stats),
    Conversations to Join (5 author-diverse, lively cards), and notable joiners."""
    specialty = profile.get('specialty', '')

    streak_banner = render_streak_banner(fellow['last_name'], streak) if streak is not None else ''
    hero = render_hero_figma(fellow, profile, act7, state)

    # "Conversations to Join" — merge interest-matched threads (first) with
    # specialty-trending threads, de-duped by post_id, capped at 5 total.
    conversations = []
    seen_ids = set()
    for p in (relevant_posts or []) + (specialty_trending or []):
        pid = p['post_id']
        if pid in seen_ids:
            continue
        seen_ids.add(pid)
        conversations.append(p)
        if len(conversations) >= 5:
            break
    conversations_html = render_trending_block_figma(conversations)

    own_work_html = ''
    if own_work and own_work.get('draft'):
        own_work_html = render_own_work_figma(own_work['draft'], own_work['source'])

    joiners_rows = render_joiners_figma(joiners, specialty) if joiners else ''

    cta_label = {
        'very': 'Keep the momentum going',
        'medium': 'Jump into a conversation',
        'inactive': 'Take a look around',
    }[state]

    # Footer copy — inactive gets the "reply with one line" prompt
    if state == 'inactive':
        footer_note_title = 'One thing before you go'
        footer_note_body = ("Reply to this email with one line on what's getting in the way — "
                            f"missing content, clunky workflow, {BRAND['inactive_aside']}. "
                            "I read every one and it shapes what we build.")
    else:
        footer_note_title = "Ideas for Roon? We're listening."
        footer_note_body = (f"As a member of {BRAND['member_of']}, your input shapes what we build. "
                            "Reply to this email anytime.")

    sections = []

    # Own-work draft leads — sits directly under the hero stats.
    if own_work_html:
        sections.append(render_section_header_figma(
            'Kick off a conversation',
            'We drafted this from your recent work — make it yours.'))
        sections.append(f'<tr><td style="padding:10px 30px 0;">{own_work_html}</td></tr>')

    if conversations_html:
        sections.append(render_section_header_figma(
            'Conversations to Join',
            'Active threads matched to your specialty, subspecialty, and research interests.'))
        sections.append(f'<tr><td style="padding:10px 30px 0;">{conversations_html}</td></tr>')

    if joiners_rows:
        sections.append(render_section_header_figma('Notable physicians who have joined',
                                                    'New on Roon in the last two weeks.'))
        sections.append(
            f'<tr><td style="padding:8px 30px 0;"><table width="100%" cellpadding="0" cellspacing="0" border="0">{joiners_rows}</table></td></tr>'
        )

    sections_html = ''.join(sections)

    html = f"""<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>* {{ box-sizing:border-box; }} body {{ margin:0; padding:0; }} a {{ text-decoration:none; }}</style>
</head>
<body style="background-color:{BG};margin:0;padding:0;">
<div style="display:none;max-height:0;overflow:hidden;">Your {escape(BRAND['weekly_title'])} digest — what happened on Roon this week.</div>
<table width="100%" border="0" cellpadding="0" cellspacing="0" style="background-color:{BG};">
<tr><td align="center">
<table width="720" cellpadding="0" cellspacing="0" border="0" style="background-color:{BG};max-width:720px;width:100%;margin:0 auto;">

  {streak_banner}

  {hero}

  {sections_html}

  <tr><td align="center" style="padding:30px 40px 10px;">
    <table cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;"><tr>
      <td align="center" style="background-color:{CARD_TEAL};border-radius:160px;padding:14px 32px;">
        <a href="{ROON_DOCTORS_HOME}" style="color:#fff;font-family:Helvetica,Arial,sans-serif;font-size:14px;font-weight:600;display:inline-block;line-height:1;">{escape(cta_label)} &#x2192;</a>
      </td>
    </tr></table>
  </td></tr>

  <tr><td style="padding:18px 40px 6px;">
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f7f3ee;border-radius:14px;">
      <tr><td style="padding:20px 26px;text-align:center;">
        <p style="margin:0 0 6px;color:#1c2326;font-family:Georgia,'Times New Roman',serif;font-size:15px;font-weight:700;">{escape(footer_note_title)}</p>
        <p style="margin:0;color:#4a5258;font-family:Helvetica,Arial,sans-serif;font-size:13px;line-height:1.55;">{escape(footer_note_body)}</p>
      </td></tr>
    </table>
  </td></tr>

  <tr><td align="center" style="padding:22px 40px 36px;">
    <p style="margin:0;color:#4a5258;font-family:Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;">— Team Roon</p>
    <p style="margin:10px 0 0;color:#9aa3a7;font-family:Helvetica,Arial,sans-serif;font-size:11px;line-height:1.6;">You're receiving this as a member of {escape(BRAND['member_of'])}.</p>
    <p style="margin:10px 0 0;font-family:Helvetica,Arial,sans-serif;font-size:11px;">
      <a href="#" style="color:#9aa3a7;">Email preferences</a> &nbsp;·&nbsp; <a href="#" style="color:#9aa3a7;">Unsubscribe</a>
    </p>
  </td></tr>

</table></td></tr></table></body></html>
"""
    return html


# --- Main -------------------------------------------------------------------

def generate_digest():
    global FELLOWS, BRAND, UTM, ROON_DOCTORS_HOME
    os.makedirs(OUT_DIR, exist_ok=True)
    argv = os.sys.argv
    use_figma = '--figma' in argv
    use_news = '--no-news' not in argv
    refresh_ownwork = '--refresh-ownwork' in argv
    # --cohort fellows|founding selects the audience + branding. Default fellows.
    cohort = 'fellows'
    if '--cohort' in argv:
        idx = argv.index('--cohort')
        if idx + 1 < len(argv):
            cohort = argv[idx + 1].strip().lower()
    if cohort not in COHORTS:
        log.error(f'Unknown --cohort {cohort!r}; valid: {", ".join(COHORTS)}')
        return []
    FELLOWS = COHORTS[cohort]['members']
    BRAND = COHORTS[cohort]['brand']
    # Per-cohort UTM so founding clicks attribute under founding_weekly (not the
    # old hardcoded fellows_weekly). Drives post_url / profile_url / CTA links.
    UTM = BRAND.get('utm', 'fellows_weekly')
    ROON_DOCTORS_HOME = f'https://www.roon.com/doctors/?utm_campaign={UTM}'
    # --full-cohort: replace the hardcoded preview slice with the FULL cohort
    # pulled live from BQ (founding only). --include-na also keeps Contract
    # 'Not Applicable'; default is Signed-only.
    if '--full-cohort' in argv:
        if cohort != 'founding':
            log.error('--full-cohort is only supported with --cohort founding')
            return []
        signed_only = '--include-na' not in argv
        FELLOWS = fetch_founding_cohort(signed_only=signed_only)
    log.info(f'Cohort: {cohort} ({len(FELLOWS)} members) — "{BRAND["weekly_title"]}"')
    # --only <substring> filters to one member; --users a,b,c filters to several
    # (case-insensitive, matched against first/last/email). For one-off previews.
    only_filter = None
    if '--only' in argv:
        idx = argv.index('--only')
        if idx + 1 < len(argv):
            only_filter = argv[idx + 1].lower()
    user_filters = None
    if '--users' in argv:
        idx = argv.index('--users')
        if idx + 1 < len(argv):
            user_filters = [u.strip().lower() for u in argv[idx + 1].split(',') if u.strip()]

    def _matches(f):
        if only_filter is not None:
            hay = f['first_name'].lower(), f['last_name'].lower(), f['email'].lower()
            return any(only_filter in h for h in hay)
        if user_filters is not None:
            hay = f"{f['first_name']} {f['last_name']} {f['email']}".lower()
            return any(uf in hay for uf in user_filters)
        return True

    profiles = fetch_profiles()
    act7 = fetch_activity(7)
    # "Physicians reached" — cumulative all-time impressions per member → hero.
    reached = fetch_physicians_reached()
    for uid, n in reached.items():
        if uid in profiles:
            profiles[uid]['reached'] = n
    # Shared pool of recent posts for "Join the conversation" + "Trending in your
    # specialty" (replaces the old global-trending + curated-by-specialty pulls).
    posts_pool = fetch_recent_posts_pool(days=30, limit=500)

    fellows_to_render = [f for f in FELLOWS if _matches(f)]
    if not fellows_to_render:
        log.error('No members match the --only/--users filter')
        return []

    # Conversation streaks (weeks with >=1 post AND >=1 comment) → top banner.
    streaks = fetch_streaks([f['user_id'] for f in fellows_to_render])

    # Interests (bio + pub titles → topic phrases) drive the "Join the
    # conversation" relevance matching. Cached (Haiku, 30-day TTL).
    refresh_interests = '--refresh-interests' in argv
    interests_cache = build_fellow_interests(profiles, refresh=refresh_interests)

    # "Kick off a conversation" — find each member's own recent work (publication
    # or news) and ghostwrite a Roon post in their voice. Cached (7-day TTL).
    # `shared_links` (from Weekly Digest Sends) prevents re-surfacing prior items.
    bios_pubs = fetch_bios_and_pubs()
    shared_links = fetch_shared_links([f['user_id'] for f in fellows_to_render])
    own_work_by_fellow = build_own_work(
        fellows_to_render, profiles, bios_pubs,
        refresh=refresh_ownwork, use_news=use_news, shared_links=shared_links)

    # Joiners — Figma layout shows 5 in the list; legacy shows 3
    joiners = fetch_notable_joiners(days=14, limit=40)
    joiners_per_fellow = 5 if use_figma else 3

    index_entries = []
    for fellow in fellows_to_render:
        uid = fellow['user_id']
        profile = profiles.get(uid)
        if not profile:
            log.warning(f'No profile for {fellow["first_name"]} {fellow["last_name"]}')
            continue
        a = act7.get(uid, {'posts': 0, 'comments': 0, 'reactions': 0, 'rounds': 0})
        state = classify(a)
        spec = profile.get('specialty', '')
        own_work = own_work_by_fellow.get(uid)
        # Join the conversation (interest-matched) + Trending in your specialty,
        # de-duped against each other and against the member's own posts.
        ints = (interests_cache.get(uid) or {}).get('interests', [])
        kw = _member_keywords(ints, (bios_pubs.get(uid) or {}).get('pub_titles', []))
        # Conversations to Join — one composed, author-diversified, lively list
        # (personal + specialty/global trending; see select_conversations).
        relevant_posts = select_conversations(profile, ints, kw, posts_pool, uid, k=5)
        specialty_trending = []
        fellow_joiners = pick_joiners_for(spec, joiners, n=joiners_per_fellow)
        if use_figma:
            html = render_email_figma(fellow, profile, a, state, relevant_posts,
                                      specialty_trending, own_work, fellow_joiners,
                                      streak=streaks.get(uid, 0))
        else:
            html = render_email(fellow, profile, a, state, relevant_posts,
                                specialty_trending, own_work, fellow_joiners)

        slug = member_slug(fellow)
        suffix = '_figma' if use_figma else ''
        path = os.path.join(OUT_DIR, f"{BRAND['file_prefix']}{suffix}_{slug}.html")
        with open(path, 'w') as fh:
            fh.write(html)
        log.info(f'  wrote {path}  [{state}]')
        index_entries.append((fellow, profile, a, state, path, own_work))

    # Index page — sidebar + iframe review UI
    suffix = '_figma' if use_figma else ''
    index_path = os.path.join(OUT_DIR, f"{BRAND['file_prefix']}{suffix}_index.html")
    _write_review_index(index_path, index_entries, use_figma=use_figma)
    log.info(f'Index: {index_path}')

    # Sidecar meta — consumed by send_fellows_weekly.py to populate Airtable
    # logging fields without re-fetching BQ at send time. Keyed by member slug.
    _STATE_TO_LEVEL = {'very': 'Very Active', 'medium': 'Medium', 'inactive': 'Inactive'}
    meta = {'campaign': BRAND['campaign'], 'cohort_title': BRAND['weekly_title'],
            'generated_at': datetime.now(timezone.utc).isoformat(),
            'layout': 'figma' if use_figma else 'legacy', 'fellows': {}}
    for fellow, profile, a, state, fpath, own_work in index_entries:
        s = member_slug(fellow)
        src = (own_work or {}).get('source')
        meta['fellows'][s] = {
            'slug': s,
            'user_id': fellow['user_id'],
            'first': fellow['first_name'],
            'last': fellow['last_name'],
            'email': fellow['email'],
            'specialty': profile.get('specialty', ''),
            'last_visit': (profile.get('last_login') or '')[:10],
            'posts': a.get('posts', 0),
            'comments': a.get('comments', 0),
            'rounds': a.get('rounds', 0),
            'reactions': a.get('reactions', 0),
            'state': state,
            'engagement_level': _STATE_TO_LEVEL.get(state, 'Inactive'),
            'own_work': ({
                'type': src.get('type', ''),
                'title': src.get('title', ''),
                'source': src.get('journal') or src.get('outlet', ''),
                'date': src.get('date', ''),
                'url': src.get('url', ''),
                'post': (own_work or {}).get('draft', {}).get('post', ''),
            } if src else None),
            'html_path': os.path.basename(fpath),
        }
    meta_path = os.path.join(OUT_DIR, f"{BRAND['file_prefix']}{suffix}_meta.json")
    with open(meta_path, 'w') as fh:
        json.dump(meta, fh, indent=2)
    log.info(f'Meta: {meta_path}')

    print(f'\n✓ {len(index_entries)} previews generated')
    print(f'  Open: {index_path}')
    return [*(entry[4] for entry in index_entries), index_path, meta_path]


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    credential_path = materialize_google_credentials()
    try:
        artifacts = generate_digest()
        write_deterministic_export(artifacts)
        log.info(f'Archive: {EXPORT_ZIP}')
    finally:
        cleanup_google_credentials(credential_path)


def _write_review_index(path: str, entries: list, use_figma: bool) -> None:
    """Sidebar + iframe review UI. Click a fellow → email loads in main pane.
    Top bar shows the fellow's specialty, 7-day activity, state, the PubMed
    paper that got picked for 'Worth bringing to Roon', and the interest list
    used to find it."""
    state_color = {'very': '#2F7483', 'medium': '#a67c3d', 'inactive': '#888'}
    rows = []
    first_path = None
    for i, (fellow, profile, a, state, fpath, own_work) in enumerate(entries):
        fname = os.path.basename(fpath)
        if first_path is None:
            first_path = fname
        name = f"Dr. {fellow['first_name']} {fellow['last_name']}"
        spec = profile.get('specialty', '') or ''
        last_login = profile.get('last_login', '') or ''
        last_visit = ''
        if last_login:
            try:
                dt = datetime.fromisoformat(last_login.replace('Z', '+00:00'))
                last_visit = dt.strftime('%b %-d')
            except Exception:
                pass
        sc = state_color.get(state, '#888')
        meta = f"{spec} · P{a['posts']}/C{a['comments']}/R{a['reactions']}"
        if last_visit:
            meta += f" · last visit {last_visit}"
        src = (own_work or {}).get('source')
        if src:
            label = _source_label(src)
            t = src.get('title', '')
            paper_html = (f'<div class="paper"><span class="paper-label">{escape(label)} →</span> '
                          f'<a href="{src.get("url","#")}" target="_blank">{escape(t)}</a></div>')
        else:
            paper_html = '<div class="paper paper-empty">No own-work match — section omitted</div>'
        post_text = (own_work or {}).get('draft', {}).get('post', '') if own_work else ''
        interests_html = ''
        if post_text:
            interests_html = '<div class="ints">' + escape(post_text) + '</div>'
        rows.append(f"""
          <li class="row" data-file="{fname}" data-name="{escape(name)}" data-meta="{escape(meta)}"
              data-state="{state}" data-paper='{escape(paper_html)}' data-interests='{escape(interests_html)}'>
            <div class="row-top">
              <span class="dot" style="background:{sc};"></span>
              <span class="name">{escape(name)}</span>
              <span class="state" style="color:{sc};">{state.upper()}</span>
            </div>
            <div class="row-meta">{escape(meta)}</div>
          </li>""")

    rows_html = ''.join(rows)
    title = f"{BRAND['weekly_title']} — Review" + (' (Figma)' if use_figma else '')
    html = f"""<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>{escape(title)}</title>
<style>
  *{{box-sizing:border-box}}
  html,body{{margin:0;padding:0;height:100%;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1c2326;background:#f5f2ee}}
  .app{{display:flex;height:100vh;}}
  .sidebar{{width:320px;flex:0 0 320px;background:#fff;border-right:1px solid #e5e1da;overflow-y:auto;}}
  .sidebar-header{{padding:18px 18px 8px;border-bottom:1px solid #e5e1da;}}
  .sidebar-header h1{{margin:0;font-size:15px;font-weight:700;letter-spacing:0.2px;}}
  .sidebar-header p{{margin:4px 0 0;font-size:12px;color:#7a8a8e;}}
  .filters{{padding:10px 18px;border-bottom:1px solid #e5e1da;display:flex;gap:6px;flex-wrap:wrap;}}
  .filter-btn{{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;padding:5px 10px;border-radius:160px;border:1px solid #d4ccc0;background:#fff;cursor:pointer;color:#4a5258;}}
  .filter-btn.active{{background:#1c2326;color:#fff;border-color:#1c2326;}}
  ul{{list-style:none;margin:0;padding:0;}}
  .row{{padding:12px 18px;border-bottom:1px solid #efeae2;cursor:pointer;}}
  .row:hover{{background:#faf7f2;}}
  .row.selected{{background:#eef3f4;border-left:3px solid #2F7483;padding-left:15px;}}
  .row-top{{display:flex;align-items:center;gap:8px;margin-bottom:4px;}}
  .dot{{width:8px;height:8px;border-radius:50%;flex:0 0 8px;}}
  .name{{font-weight:700;font-size:14px;flex:1;}}
  .state{{font-size:10px;font-weight:700;letter-spacing:0.6px;}}
  .row-meta{{font-size:11px;color:#7a8a8e;line-height:1.4;padding-left:16px;}}
  .main{{flex:1;display:flex;flex-direction:column;min-width:0;}}
  .topbar{{background:#fff;border-bottom:1px solid #e5e1da;padding:14px 22px;}}
  .topbar .name{{font-size:16px;font-weight:700;display:block;margin-bottom:3px;}}
  .topbar .meta{{font-size:12px;color:#7a8a8e;display:block;}}
  .paper{{margin-top:8px;font-size:13px;line-height:1.45;}}
  .paper a{{color:#2F7483;font-weight:600;text-decoration:none;}}
  .paper a:hover{{text-decoration:underline;}}
  .paper-label{{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#a8b0b4;margin-right:6px;}}
  .paper-journal{{color:#7a8a8e;font-style:italic;}}
  .paper-empty{{color:#a8b0b4;font-style:italic;}}
  .ints{{margin-top:4px;font-size:11px;color:#7a8a8e;}}
  .ints{{white-space:pre-wrap;}}
  .ints::before{{content:'draft post: ';font-weight:600;color:#a8b0b4;display:block;}}
  .preview{{flex:1;overflow:auto;background:#e8e3dc;padding:24px;display:flex;justify-content:center;}}
  .preview iframe{{width:720px;max-width:100%;height:100%;min-height:100vh;border:0;border-radius:6px;box-shadow:0 4px 20px rgba(0,0,0,0.08);background:#f2edea;}}
  .controls{{padding:10px 22px;background:#fff;border-bottom:1px solid #e5e1da;font-size:12px;display:flex;gap:14px;align-items:center;}}
  .controls a{{color:#2F7483;text-decoration:none;font-weight:600;}}
  .controls a:hover{{text-decoration:underline;}}
</style></head><body>
<div class="app">
  <aside class="sidebar">
    <div class="sidebar-header">
      <h1>{escape(title)}</h1>
      <p>{len(entries)} fellow{'s' if len(entries) != 1 else ''} · click to review</p>
    </div>
    <div class="filters">
      <button class="filter-btn active" data-filter="all">All</button>
      <button class="filter-btn" data-filter="very">Very active</button>
      <button class="filter-btn" data-filter="medium">Medium</button>
      <button class="filter-btn" data-filter="inactive">Inactive</button>
    </div>
    <ul id="rows">{rows_html}</ul>
  </aside>
  <main class="main">
    <div class="topbar">
      <span class="name" id="topName">—</span>
      <span class="meta" id="topMeta">—</span>
      <div id="topPaper"></div>
      <div id="topInterests"></div>
    </div>
    <div class="controls">
      <a id="openTab" href="#" target="_blank">↗ Open in new tab</a>
      <span style="color:#a8b0b4;">·</span>
      <a id="prevBtn" href="#">← Prev</a>
      <a id="nextBtn" href="#">Next →</a>
      <span style="color:#a8b0b4;margin-left:auto;">Tip: ↑/↓ keys to navigate</span>
    </div>
    <div class="preview">
      <iframe id="frame" src=""></iframe>
    </div>
  </main>
</div>
<script>
  const rows = Array.from(document.querySelectorAll('.row'));
  const frame = document.getElementById('frame');
  const topName = document.getElementById('topName');
  const topMeta = document.getElementById('topMeta');
  const topPaper = document.getElementById('topPaper');
  const topInterests = document.getElementById('topInterests');
  const openTab = document.getElementById('openTab');
  let currentIdx = 0;
  let activeFilter = 'all';

  function visibleRows() {{
    return rows.filter(r => activeFilter === 'all' || r.dataset.state === activeFilter);
  }}

  function select(idx) {{
    const vis = visibleRows();
    if (!vis.length) return;
    currentIdx = (idx + vis.length) % vis.length;
    const r = vis[currentIdx];
    rows.forEach(x => x.classList.remove('selected'));
    r.classList.add('selected');
    r.scrollIntoView({{block: 'nearest'}});
    frame.src = r.dataset.file;
    topName.textContent = r.dataset.name;
    topMeta.textContent = r.dataset.meta;
    topPaper.innerHTML = r.dataset.paper;
    topInterests.innerHTML = r.dataset.interests;
    openTab.href = r.dataset.file;
  }}

  rows.forEach((r, i) => r.addEventListener('click', () => {{
    activeFilter = 'all';
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.toggle('active', b.dataset.filter === 'all'));
    rows.forEach(x => x.style.display = '');
    currentIdx = visibleRows().indexOf(r);
    select(currentIdx);
  }}));

  document.querySelectorAll('.filter-btn').forEach(btn => {{
    btn.addEventListener('click', () => {{
      activeFilter = btn.dataset.filter;
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.toggle('active', b === btn));
      rows.forEach(r => r.style.display = (activeFilter === 'all' || r.dataset.state === activeFilter) ? '' : 'none');
      if (visibleRows().length) select(0);
    }});
  }});

  document.getElementById('prevBtn').addEventListener('click', e => {{ e.preventDefault(); select(currentIdx - 1); }});
  document.getElementById('nextBtn').addEventListener('click', e => {{ e.preventDefault(); select(currentIdx + 1); }});
  document.addEventListener('keydown', e => {{
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === 'ArrowDown' || e.key === 'j') {{ e.preventDefault(); select(currentIdx + 1); }}
    if (e.key === 'ArrowUp' || e.key === 'k') {{ e.preventDefault(); select(currentIdx - 1); }}
  }});

  if (rows.length) select(0);
</script></body></html>
"""
    with open(path, 'w') as fh:
        fh.write(html)


if __name__ == '__main__':
    main()
