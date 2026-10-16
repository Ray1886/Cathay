---
name: Lounge itinerary prototype
description: A restrained Cathay-inspired travel interface with compact context and clear actions
colors:
  accent: "#00645d"
  accent-hover: "#004d47"
  ink: "#23332f"
  muted: "#63706b"
  surface: "#ffffff"
  canvas: "#f5f7f6"
  soft: "#edf3f0"
  line: "#e5eae7"
  warning: "#845b22"
  warning-bg: "#fbf5e9"
  error: "#a83c32"
  confirmed: "#33765b"
  control-border: "#d0dbd3"
  preview-background: "#e9edeb"
typography:
  headline:
    fontFamily: '"Lounge Sans TC", -apple-system, BlinkMacSystemFont, "PingFang TC", "Microsoft JhengHei", sans-serif'
    fontSize: "22px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "0"
  title:
    fontFamily: '"Lounge Sans TC", -apple-system, BlinkMacSystemFont, "PingFang TC", "Microsoft JhengHei", sans-serif'
    fontSize: "20px"
    fontWeight: 600
    lineHeight: 1.5
  section:
    fontFamily: '"Lounge Sans TC", -apple-system, BlinkMacSystemFont, "PingFang TC", "Microsoft JhengHei", sans-serif'
    fontSize: "18px"
    fontWeight: 600
    lineHeight: 1.5
  activity:
    fontFamily: '"Lounge Sans TC", -apple-system, BlinkMacSystemFont, "PingFang TC", "Microsoft JhengHei", sans-serif'
    fontSize: "16px"
    fontWeight: 500
    lineHeight: 1.55
  body:
    fontFamily: '"Lounge Sans TC", -apple-system, BlinkMacSystemFont, "PingFang TC", "Microsoft JhengHei", sans-serif'
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.6
  conversation:
    fontFamily: '"Lounge Sans TC", -apple-system, BlinkMacSystemFont, "PingFang TC", "Microsoft JhengHei", sans-serif'
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.85
  label:
    fontFamily: '"Lounge Sans TC", -apple-system, BlinkMacSystemFont, "PingFang TC", "Microsoft JhengHei", sans-serif'
    fontSize: "12px"
    fontWeight: 400
  field:
    fontFamily: '"Lounge Sans TC", -apple-system, BlinkMacSystemFont, "PingFang TC", "Microsoft JhengHei", sans-serif'
    fontSize: "16px"
    fontWeight: 500
    lineHeight: 1.6
rounded:
  tag: "4px"
  text-control: "6px"
  menu-item: "7px"
  field: "8px"
  action: "10px"
  context: "12px"
  preview: "18px"
  sheet: "20px"
  circle: "50%"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  conversation-inset: "20px"
  page-inset: "22px"
  section-gap: "28px"
components:
  button-sheet-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.surface}"
    rounded: "{rounded.action}"
    padding: "11px 16px"
    width: "100%"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
  button-booking-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.surface}"
    rounded: "{rounded.field}"
    padding: "9px 12px"
  button-booking-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.accent}"
    rounded: "{rounded.field}"
    padding: "9px 12px"
  button-text:
    backgroundColor: "transparent"
    textColor: "{colors.accent}"
    rounded: "{rounded.text-control}"
    padding: "6px 0 6px 8px"
  button-planner-primary:
    backgroundColor: "transparent"
    textColor: "{colors.accent}"
    rounded: "{rounded.field}"
    padding: "5px 0"
    height: "56px"
  field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.field}"
    rounded: "{rounded.field}"
    padding: "11px 12px"
    width: "100%"
  flight-context:
    backgroundColor: "{colors.soft}"
    textColor: "{colors.ink}"
    rounded: "{rounded.context}"
    padding: "16px"
  booking-navigation:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.muted}"
    padding: "3px"
  booking-navigation-selected:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.text-control}"
    padding: "7px 3px"
  service-row:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    padding: "17px 0"
  activity-menu:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.context}"
    padding: "5px"
  proposal-tag:
    backgroundColor: "{colors.soft}"
    textColor: "{colors.accent}"
    rounded: "{rounded.tag}"
    padding: "3px 6px"
---

# Design System: Lounge itinerary prototype

## Overview

**Creative North Star: "A familiar lounge itinerary"**

This mobile travel tool uses Operate mode: a traveller should understand the available time, current activities and next action without decoding a dashboard. The approved direction follows the restrained white surfaces, dark teal actions and clear flight information in [Cathay Pacific's official App Store screenshots](https://apps.apple.com/us/app/cathay-pacific/id305038764). It remains a hackathon prototype without official branding or a claim of affiliation.

This refresh records the implemented system in styles.css, index.html, app.js and reservation-ui.js. It includes compact flight context, a simpler timeline, native activity menus, a text-only itinerary and illustrated service rows, separate booking views and a local Traditional Chinese font. The follow-up restores the original four-point assistant mark, adds softly tinted conversation space with framed AI replies, and aligns the planner footer with the assistant toolbar. It supersedes the previous claim that the branch differs only in CSS and theme-color metadata. Reservation integration retains its recorded provenance in Ray's upstream commit 5abcd8f81884fc8f58acf7c18181bfe58368ac37; presentation changes do not redefine its API, approval or business rules.

**Key Characteristics:**

- White reading surfaces with restrained teal actions and explicit state text.
- Local Lounge Sans TC for the bundled interface, with system fallback for missing glyphs.
- Compact flight context, a readable timeline and flat service rows.
- Native disclosure for activity actions and inventory diagnostics.
- Fixed planning actions and conversation input, with independently scrolling content.

## Colors

The accent is reserved for actions, focus and selected states. Supporting text stays quieter than primary content while remaining part of the same green-neutral family. Frontmatter is normative; sidecar tonal ramps are generated swatch previews, not additional application colors.

### Primary

- **Deep teal**: accent drives primary actions, links, focus outlines and active controls; accent-hover deepens filled actions for a fine pointer.
- **Soft green**: soft groups flight context, the compact current plan, user messages and low-emphasis notices.

### Neutral

- **White surface**: surface supports the application, menus, sheets and form controls.
- **Deep green-black**: ink carries headings, activity names and main content.
- **Muted green-grey**: muted carries secondary times, locations, help and default status text.
- **Off-white canvas**: canvas groups supporting plan information and booking navigation.
- **Fine separator**: line separates timeline content, service rows, booking entries and fixed regions.
- **Control border**: control-border is the shared form and secondary-action stroke.
- **Desktop surround**: preview-background frames the narrow application on wider screens.

### Status

- **Confirmed green**: confirmed supports explicit confirmed/result text.
- **Warning brown**: warning with warning-bg marks conflicts, pending work and time-sensitive notices.
- **Error red**: error marks inline errors and destructive action text.

**The State With Text Rule.** Confirmed, pending, offered and expired states retain readable labels; color never stands in for the booking state or approval requirement.

## Typography

**Interface font:** Lounge Sans TC, a renamed local WOFF 2 subset of Noto Sans TC. The CSS fallback order is the system UI, PingFang TC, Microsoft JhengHei, then sans-serif. The font is preloaded in index.html and uses font-display: swap. No synthetic weights are requested.

The bundled file contains 822 Unicode codepoints and is not a complete CJK font. Unknown Chinese chat text and other missing glyphs use the system fallback. CSS exposes normal weights 400–600; the file retains a wider internal weight axis. Provenance, the exact asset hash and update policy live in assets/fonts/README.md. This font choice does not claim to reproduce Cathay's proprietary typography.

### Hierarchy

- **Headline**: the planner title; reduced to 20px at the narrow breakpoint.
- **Title**: assistant and task-sheet headings.
- **Section**: itinerary and service-discovery headings.
- **Activity**: timeline names; service names use the same size and weight without a distinct line-height declaration.
- **Body**: standard interface content; **Conversation** adds a wider line-height for messages.
- **Label**: secondary content, with contextual line-height rather than a single forced rhythm.
- **Field**:16px form input and select text; the conversation input is also 16px but uses regular weight and 1.5 line-height.
- Time values use tabular-nums across the interface. There is no separate mono or display face.

**The One Interface Typeface Rule.** Keep operational headings, forms and messages in the bundled interface family and its fallback stack; do not introduce a decorative display pairing or synthesize unprovided weights.

## Layout

The application is a single vertical mobile panel, with width min(100%,440px), a minimum document width of 320px and dynamic viewport height. The planner keeps flight context above its scrolling content and three actions below it. The footer uses three equal-width actions, each with its icon above its label, matching the assistant toolbar. Save remains a distinct action with a teal accent; it is not presented as a selected navigation destination. The conversation keeps its header, compact live plan and composer outside the scrolling message log; all five existing quick actions remain visible below the input.

Planner content uses 22px horizontal insets. Assistant content uses 20px, and most shared form/list spacing uses the observed 4/8/12/16px steps. The itinerary uses a four-column grid: 54px time, 10px node, flexible activity content and 36px menu, with 8px gaps and a 99px minimum row height. The timeline stays text-only. The “可添加行程” service rows use a 72×96px thumbnail beside the service name, reservation state, available times and action. Images have 8px corners and reuse the fictional lounge-scene asset.

At widths of at least 560px, the application becomes a bordered 18px-radius preview panel, with 20px outer top/bottom margins, height calc(100dvh -40px) and a 930px maximum height. Sheets move 20px above the viewport bottom and gain rounded lower corners. At widths up to 360px, planner and assistant insets reduce to 16px, the planner title to 20px, timeline columns to 45px /8px / flexible /30px with 7px gaps and service thumbnails to 64×88px, and sheet insets to 18px. Safe-area insets remain part of headers, footers and sheets.

Most task buttons and native menu triggers provide 44px or 48px height. Existing smaller send, booking-tab, inventory-disclosure, refresh and sheet-close dimensions are implementation exceptions, not a general target-size standard for future components. Browser screenshots under the workspace output/visual-refinement directory document this pass; screenshots alone do not establish real-device keyboard or touch behavior.

## Elevation & Depth

The interface is flat by default. Lists and general containers use proximity, tonal grouping and single separators; their base container style has no border radius or shadow. Depth is reserved for a native activity menu, the selected booking segment and a modal sheet's backdrop.

### Shadow Vocabulary

- **Activity menu** (0 5px 26px #173d2821): separates the open action menu from the timeline.
- **Selected booking segment** (0 1px 3px #173d2810): gives the active segment a slight edge against its off-white track.
- **Sheet backdrop** (#18372c52): dims the application behind the modal task sheet.

**The Flat Except Overlays Rule.** Keep ordinary activity and service content flat; use the existing menu and selected-segment shadows only for those specific layers.

## Shapes

Primary task actions and supporting notices use the shared 10px radius. Fields, booking actions and compact response actions use 8px corners; text controls use 6px. Flight context, plan preview, menu surfaces and proposal containers use 12px corners. User messages have 14px corners with a 3px lower-right corner. Bottom sheets use 20px upper corners on mobile; desktop previews round all sheet corners. Timeline nodes and back controls are circular. These shapes distinguish grouping and action without turning every row into a card.

## Components

### Buttons

Filled sheet actions use the accent and white text, full width, at least 48px height,15px type and 500 weight. The planner footer uses 56px-high icon-over-label actions with 20px icons and 11px labels. Save uses teal text and an icon, without a filled block. The assistant quick-action icons also use 20px. Booking primary/secondary actions share 8px corners,13px regular type and at least 44px height; secondary actions retain a white background and the shared border. Text actions stay transparent with modest 6px corners.

Fine-pointer hover adds a soft background to quiet controls and deepens filled actions. Press feedback scales buttons to 0.98; disabled controls use 0.45 opacity. Keyboard focus uses a 2px accent outline with 3px offset. These states do not change what an action approves.

### Compact Flight Context

A softly tinted context block groups the flight code/destination, boarding time and gate, with a small demonstration label. It uses 16px padding and 12px corners; a separate overview row states the usable lounge duration and time range. The hidden legacy hero imagery and fake status bar are not part of the visible system.

### Itinerary and Native Activity Menus

The timeline leads with start/end times, activity name, location and explicit state. A 44×44px native details/summary trigger opens edit/remove actions; the renderer uses exclusive activity menus, supports opening upward near the content edge, and closes menus on outside click or Escape. Reordering replaces the menu with up/down controls, keeping the existing function accessible without always exposing every action. Timing, cancellation and reservation checks remain in the existing application logic.

### Service Rows

Service discovery pairs a compact service thumbnail with the service name, reservation requirement, available times and one action. Keep photography in “可添加行程”; “我的行程” stays a text-only timeline. Images are concept imagery, not verified photos of the displayed facility.

### Inputs / Fields

Fields stack their label and control with 7px spacing. Native input/select controls are 16px, at least 48px high, white, lightly bordered and 8px rounded. Two related fields share a two-column grid with 12px gap. Errors are inline and retain error color; the booking filters put the date across both columns before lounge and service selectors.

The conversation input sits inside a shared 12px-radius bordered row. Focus changes that row's border instead of adding a second outline inside it. Voice and send actions remain available beside the text input.

### Booking Views

The existing reservation controller now presents three distinct views: “可選時段”, “我的預約” and “我的候補”. The active view uses a selected white segment on an off-white track. Results are flat rows with time/service, date/lounge, availability or queue state, and task actions. Demonstration inventory details stay behind native disclosure, below the useful passenger information.

Booking, replacement, cancellation, joining/leaving a queue and accepting an offer still require the controller's reviewable confirmation step. A busy operation disables its controls; stale context, eligibility, inventory and expired-offer rules remain enforced by the existing model/API. A view or style change does not imply a successful reservation. The existing SQLite reservation integration is prototype infrastructure, not a connection to Cathay inventory.

### Assistant and Proposals

A compact current-plan preview sits below flight context. The conversation canvas uses the existing off-white canvas color. AI replies use white bubbles with a fine border, 14px corners and a 3px upper-left corner; the original teal four-point mark sits beside them. User messages use the soft background. Proposal and opportunity messages use the same framed vocabulary without stacked shadows. Small proposal tags identify added, changed or removed items; the full preview retains times, state and warnings.

“取消修改” and “確認並保存” remain separate actions. A pending proposal cannot silently apply itself: existing confirmation, validation and stale-proposal checks still govern it. The five quick actions remain 查看行程 / 重新優化 / 貴賓室對比 / 智能推薦 / 突發修改.

### Sheets and Motion

Shared native dialog sheets remain no wider than 440px and no taller than 88dvh, with a small handle, task title, close control and scrollable content. Sheets animate for 220ms from a 16px downward offset and 0.5 opacity. Control transitions use 160ms, with ease for color and the shared cubic-bezier for transforms. Toasts use 180ms and an 8px offset. Reduced-motion preference removes transitions and animations and restores automatic scrolling.

## Do's and Don'ts

### Do:

- **Do** keep flight context compact and give the actual itinerary the main reading space.
- **Do** use the bundled interface font with its explicit fallback stack and tabular time values.
- **Do** use flat service rows, clear separators and native disclosure for secondary actions.
- **Do** preserve all five quick actions, native controls and keyboard focus.
- **Do** keep booking state, demonstration labels and confirmation requirements explicit.
- **Do** preserve existing API, approval, reservation, timing and recovery rules when changing presentation.

### Don't:

- **Don't** reintroduce decorative hero photography, fake device status chrome, section slogans or nested discovery cards.
- **Don't** treat a pending proposal, queue entry or offered slot as an approved reservation.
- **Don't** present SQLite demo inventory or a simulated flight as live Cathay data.
- **Don't** add a display font, synthetic font weight or a claim of complete CJK coverage.
- **Don't** generalize current smaller target exceptions or hidden legacy decorative symbols into component defaults.
- **Don't** apply overlay shadows to every list row or plain container.
