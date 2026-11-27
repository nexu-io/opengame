"""Record one UTC day's GitHub star total and render a hand-drawn Star History SVG."""

import argparse
import csv
import math
import os
from datetime import date
from pathlib import Path

W, H = 800, 533
ML, MR, MT, MB = 92, 48, 72, 92
PW, PH = W - ML - MR, H - MT - MB


def record(history, day, stars):
    if stars < 0 or (history and day < max(history)):
        raise ValueError("Expected a nonnegative star count on or after the latest date")
    history[day] = stars


def wobble_line(x1, y1, x2, y2, segs=24, amp=1.0):
    pts = []
    for i in range(segs + 1):
        f = i / segs
        x = x1 + (x2 - x1) * f
        y = y1 + (y2 - y1) * f
        if 0 < i < segs:
            j = math.sin(i * 2.3 + x1 * 0.1) * amp
            if abs(x2 - x1) > abs(y2 - y1):
                y += j
            else:
                x += j
        pts.append(f"{x:.1f},{y:.1f}")
    return "M" + " L".join(pts)


def chart(history, repo="nexu-io/opengame", title="Star History"):
    dates = sorted(history)
    first, last = dates[0], dates[-1]
    span = max((last - first).days, 1)
    peak = max(max(history.values()), 1)
    unit = 10 ** math.floor(math.log10(max(peak / 5, 1)))
    step = next(n * unit for n in (1, 2, 5, 10) if n * unit >= peak / 5)
    ceiling = math.ceil(peak / step) * step
    latest_stars = history[last]

    def sx(day):
        return ML + PW * (day - first).days / span

    def sy(count):
        return MT + PH - PH * count / ceiling

    curve_pts = []
    for i, day in enumerate(dates):
        x, y = sx(day), sy(history[day])
        if 0 < i < len(dates) - 1:
            y += math.sin(i * 1.9) * 0.8
        curve_pts.append((x, y))

    if len(curve_pts) == 1:
        x0, y0 = curve_pts[0]
        curve_d = f"M{ML:.1f},{sy(0):.1f} L{x0:.1f},{y0:.1f}"
    else:
        curve_d = f"M{curve_pts[0][0]:.1f},{curve_pts[0][1]:.1f}"
        for i in range(1, len(curve_pts)):
            px, py = curve_pts[i - 1]
            cx, cy = curve_pts[i]
            mx, my = (px + cx) / 2, (py + cy) / 2
            curve_d += f" Q{px:.1f},{py:.1f} {mx:.1f},{my:.1f}"
        curve_d += f" L{curve_pts[-1][0]:.1f},{curve_pts[-1][1]:.1f}"

    lx, ly, lh = ML + 16, MT + 12, 36
    lw = max(168, len(repo) * 9 + 44)
    legend_box = (
        f"{wobble_line(lx, ly, lx + lw, ly, 12, 0.7)} "
        f"{wobble_line(lx + lw, ly, lx + lw, ly + lh, 6, 0.7)} "
        f"{wobble_line(lx + lw, ly + lh, lx, ly + lh, 12, 0.7)} "
        f"{wobble_line(lx, ly + lh, lx, ly, 6, 0.7)}"
    )

    svg = [f'''<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" role="img" aria-labelledby="title desc">
  <title id="title">{title} — {repo}</title>
  <desc id="desc">Daily GitHub stars for {repo} from {first} to {last}. Latest total: {latest_stars:,}.</desc>
  <defs>
    <style>
      svg {{ font-family: "Comic Sans MS", "Chalkboard SE", "Bradley Hand", system-ui, sans-serif; }}
      .bg {{ fill: #ffffff; }}
      .fg {{ fill: #111111; }}
      .axis {{ fill: none; stroke: #111111; stroke-width: 2.6; stroke-linecap: round; stroke-linejoin: round; }}
      .legend-bg {{ fill: rgba(255,255,255,0.92); }}
      .series {{ fill: none; stroke: #dd4528; stroke-width: 3.4; stroke-linecap: round; stroke-linejoin: round; }}
      .swatch {{ fill: #dd4528; }}
      .muted {{ fill: #57606a; }}
      @media (prefers-color-scheme: dark) {{
        .bg {{ fill: #0d1117; }}
        .fg {{ fill: #e6edf3; }}
        .axis {{ stroke: #e6edf3; }}
        .legend-bg {{ fill: rgba(13,17,23,0.92); }}
        .series {{ stroke: #ff6b4a; }}
        .swatch {{ fill: #ff6b4a; }}
        .muted {{ fill: #8b949e; }}
      }}
    </style>
  </defs>
  <rect class="bg" width="{W}" height="{H}" rx="8" />
  <g transform="translate(316, 22)">
    <circle cx="12" cy="12" r="10.5" class="axis" style="stroke-width:2.4" />
    <path d="M12 6.5 L12 12.5 L16 14.5" class="axis" style="stroke-width:2.2" />
  </g>
  <text x="348" y="42" font-size="24" font-weight="700" class="fg">{title}</text>
  <path class="axis" d="{wobble_line(ML, MT, ML, MT + PH, 28, 1.0)}" />
  <path class="axis" d="{wobble_line(ML, MT + PH, ML + PW, MT + PH, 32, 1.0)}" />''']

    for tick in range(step, ceiling + 1, step):
        label = f"{tick / 1000:g}k" if tick >= 1000 else str(tick)
        svg.append(f'  <text x="{ML - 10:.1f}" y="{sy(tick) + 5:.1f}" text-anchor="end" font-size="16" class="fg">{label}</text>')

    for i in sorted({round(n * (len(dates) - 1) / 5) for n in range(6)}):
        day = dates[i]
        svg.append(f'  <text x="{sx(day):.1f}" y="{MT + PH + 24:.1f}" text-anchor="middle" font-size="16" class="fg">{day:%b %d}</text>')

    svg.append(f'  <text x="{ML + PW / 2:.1f}" y="{H - 22}" text-anchor="middle" font-size="18" class="fg">Date</text>')
    svg.append(f'  <text x="26" y="{MT + PH / 2:.1f}" text-anchor="middle" font-size="18" class="fg" transform="rotate(-90 26 {MT + PH / 2:.1f})">GitHub Stars</text>')
    svg.append(f'  <path class="series" d="{curve_d}" />')
    svg.append(f'  <rect x="{lx}" y="{ly}" width="{lw}" height="{lh}" rx="4" class="legend-bg" />')
    svg.append(f'  <path class="axis" style="stroke-width:2" d="{legend_box}" />')
    svg.append(f'  <rect x="{lx + 12}" y="{ly + 12}" width="11" height="11" rx="2" class="swatch" />')
    svg.append(f'  <text x="{lx + 31}" y="{ly + 23}" font-size="16" class="fg">{repo}</text>')
    svg.append(f'''  <g transform="translate({ML + PW - 168}, {MT + PH + 38})">
    <path d="M12 2 L14.9 8.2 L21.8 9 L16.7 13.7 L18 20.5 L12 17.2 L6 20.5 L7.3 13.7 L2.2 9 L9.1 8.2 Z" fill="#f2c94c" stroke="#d4a017" stroke-width="1.6" stroke-linejoin="round" />
    <text x="28" y="16" font-size="15" class="muted">{latest_stars:,} stars</text>
  </g>''')
    return "\n".join([*svg, "</svg>", ""])


def update(directory, day, stars, repo=None, title="Star History"):
    repo = repo or os.environ.get("GITHUB_REPOSITORY") or "nexu-io/opengame"
    directory.mkdir(parents=True, exist_ok=True)
    data = directory / "stars.csv"
    history = {}
    if data.exists():
        with data.open(newline="") as source:
            rows = csv.DictReader(source)
            if rows.fieldnames != ["date", "stars"]:
                raise ValueError("Invalid stars.csv header")
            for row in rows:
                observed = date.fromisoformat(row["date"])
                if observed in history:
                    raise ValueError(f"Duplicate observation for {observed}")
                record(history, observed, int(row["stars"]))
    record(history, day, stars)
    svg = chart(history, repo=repo, title=title)
    with data.open("w", newline="") as out:
        writer = csv.writer(out, lineterminator="\n")
        writer.writerow(["date", "stars"])
        writer.writerows(sorted(history.items()))
    (directory / "star-history.svg").write_text(svg, encoding="utf-8")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    parser.add_argument("day", type=date.fromisoformat)
    parser.add_argument("stars", type=int)
    parser.add_argument("--repo", default=None)
    parser.add_argument("--title", default="Star History")
    args = parser.parse_args()
    update(args.directory, args.day, args.stars, repo=args.repo, title=args.title)
