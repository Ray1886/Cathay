# Lounge prototype visual system

This mobile travel tool uses Operate mode. The visual direction follows the restrained white surfaces, dark teal actions and clear flight information in Cathay Pacific's official App Store screenshots. It remains a hackathon prototype without official branding or a claim of affiliation.

- System sans-serif with traditional Chinese coverage; 12–16 px supporting text; 18–21 px section/navigation headings; tabular time values.
- White surfaces, neutral off-white canvas, dark teal `#006564` actions, muted text `#5b6b6d`. Green and amber distinguish confirmed and waitlist states.
- A 4 px spacing scale. Use proximity and single separators instead of nested cards, gradients and shadows.
- A readable itinerary timeline. Photography belongs in discovery, rather than every activity row.
- Compact assistant context, readable conversations and consistent forms. All five existing quick actions remain available.
- Full viewport and safe-area insets on mobile; restrained 480 px mobile panel on desktop. Support keyboard focus, narrow screens, scrolling and reduced motion.

## Change boundary

Visual changes are limited to `styles.css` and browser theme-color metadata. CSS hides decorative imagery, fake status-bar chrome, section slogans and repeated duration text; the live duration/time range remain visible in the overview.

## Upstream reservation integration

This branch incorporates Ray's `5abcd8f81884fc8f58acf7c18181bfe58368ac37` commit, which connects the existing booking and waitlist interface to SQLite. All JavaScript, server/database/recovery modules, tests and functional HTML hooks match that upstream version. The booking panel's filters, inventory rows, confirmation actions and queue states use the same visual tokens as the rest of this UI. Relative to that upstream commit, only `styles.css`, the theme-color metadata and this design document differ.

Reference: https://apps.apple.com/us/app/cathay-pacific/id305038764

Applied skills: Impeccable (distill/layout and Operate guidance), redesign-existing-projects. The user's request for a simple functional interface takes precedence over decorative techniques.
