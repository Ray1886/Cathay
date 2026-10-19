---
name: Lounge itinerary prototype
description: The user-selected lounge film appearance in a working travel interface
colors:
  accent: "#23635b"
  accent-hover: "#1b5049"
  ink: "#213b34"
  muted: "#627269"
  surface: "#ffffff"
  canvas: "#f4f6f2"
  soft: "#edf3ef"
  line: "#e2e8e3"
  warning: "#876329"
  warning-bg: "#fbf5e9"
  error: "#a83c32"
  confirmed: "#33765b"
  field-border: "#cbd7ce"
  control-border: "#d0dbd3"
  sheet-surface: "#fdfefd"
  preview-background: "#eef1eb"
typography:
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"PingFang TC\", \"PingFang SC\", \"Lounge Sans TC\", \"Microsoft JhengHei\", sans-serif"
    fontSize: "21px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "-.02em"
  section:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"PingFang TC\", \"PingFang SC\", \"Lounge Sans TC\", \"Microsoft JhengHei\", sans-serif"
    fontSize: "18px"
    fontWeight: 600
    lineHeight: 1.45
  activity:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"PingFang TC\", \"PingFang SC\", \"Lounge Sans TC\", \"Microsoft JhengHei\", sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1.5
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"PingFang TC\", \"PingFang SC\", \"Lounge Sans TC\", \"Microsoft JhengHei\", sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.55
  conversation:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"PingFang TC\", \"PingFang SC\", \"Lounge Sans TC\", \"Microsoft JhengHei\", sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.65
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"PingFang TC\", \"PingFang SC\", \"Lounge Sans TC\", \"Microsoft JhengHei\", sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.6
  field:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"PingFang TC\", \"PingFang SC\", \"Lounge Sans TC\", \"Microsoft JhengHei\", sans-serif"
    fontSize: "16px"
    fontWeight: 500
    lineHeight: 1.55
  navigation:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"PingFang TC\", \"PingFang SC\", \"Lounge Sans TC\", \"Microsoft JhengHei\", sans-serif"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.4
rounded:
  tag: "4px"
  text-control: "6px"
  compact: "8px"
  notice: "10px"
  control: "12px"
  action: "13px"
  context: "14px"
  panel: "16px"
  pill: "22px"
  sheet: "26px"
  circle: "50%"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  conversation-inset: "20px"
  page-inset: "24px"
  section-gap: "28px"
components:
  button-sheet-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.surface}"
    rounded: "{rounded.action}"
    padding: "12px 16px"
    width: "100%"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
  button-booking-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.surface}"
    rounded: "{rounded.compact}"
    padding: "9px 12px"
  button-booking-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.accent}"
    rounded: "{rounded.compact}"
    padding: "9px 12px"
  button-text:
    backgroundColor: "transparent"
    textColor: "{colors.accent}"
    rounded: "{rounded.text-control}"
    padding: "6px 0 6px 8px"
  button-context:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.accent}"
    rounded: "{rounded.control}"
    padding: "9px 4px"
  button-quick:
    backgroundColor: "transparent"
    textColor: "{colors.accent}"
    rounded: "{rounded.pill}"
    padding: "7px 10px"
  field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.field}"
    rounded: "{rounded.control}"
    padding: "12px 13px"
    width: "100%"
  time-context:
    backgroundColor: "{colors.soft}"
    textColor: "{colors.ink}"
    rounded: "{rounded.context}"
    padding: "13px 15px"
  app-navigation:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.muted}"
    typography: "{typography.navigation}"
    rounded: "{rounded.control}"
    padding: "3px 0"
  app-navigation-current:
    backgroundColor: "transparent"
    textColor: "{colors.accent}"
    rounded: "{rounded.control}"
  booking-navigation:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.muted}"
    padding: "3px"
  booking-navigation-selected:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.text-control}"
    padding: "7px 3px"
  assistant-reply:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.conversation}"
    rounded: "{rounded.panel}"
    padding: "14px 16px"
  user-message:
    backgroundColor: "{colors.soft}"
    textColor: "{colors.ink}"
    typography: "{typography.conversation}"
    rounded: "{rounded.panel}"
    padding: "12px 15px"
  composer:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    padding: "4px 5px 4px 16px"
  activity-menu:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "5px"
  proposal-tag:
    backgroundColor: "{colors.soft}"
    textColor: "{colors.accent}"
    rounded: "{rounded.tag}"
    padding: "3px 6px"
---

# Design System: Lounge itinerary prototype

## Overview

**Creative North Star: "The lounge from the films"**

Bring the user-selected pitch-clips-v3 appearance into an interactive travel tool. White and light sage surfaces, dark teal controls and system-first typography create a quiet, familiar mobile hierarchy. Compact travel context gives time, activity and booking state their own clear places.

The interface favors open reading over decorative framing: the itinerary is text-led, while authentic Cathay photographs appear in available-service rows. The original four-point assistant mark and framed white replies give conversations continuity with the films. Product behavior and approval boundaries remain governed by PRODUCT.md; imagery does not imply official integration, eligibility or live inventory.

**Key Characteristics:**

- White and sage surfaces with a restrained dark teal action color.
- System-first typography, tabular times and explicit booking state text.
- Compact flight context, an open timeline and authentic service photographs.
- One shared three-item tab bar, with save and time controls beside the plan.
- Framed assistant replies, sage user messages and a compact voice/text composer.

## Colors

The palette is a quiet green-neutral family with one teal action accent. The frontmatter records the application values; sidecar tonal ramps are panel swatch previews, not extra application colors.

### Primary

- **Lounge teal**: accent drives filled confirmations, action text, active navigation and focus. Accent hover deepens filled controls for a fine pointer.

### Neutral

- **White surface**: the planner, service rows, assistant replies, controls and fixed navigation.
- **Sage context**: soft groups available time, boarding context, user messages and low-emphasis notices.
- **Light canvas**: canvas supports conversation space and segmented booking navigation.
- **Deep green ink** and **muted green-grey**: ink carries the reading hierarchy; muted carries supporting times, venues, hints and inactive navigation.
- **Fine separator**, **field border** and **control border**: line separates content and frames replies; the two established strokes distinguish native fields/proposal actions from compact booking actions.
- **Sheet white** and **desktop surround**: sheet-surface is the slightly tinted modal surface; preview-background surrounds the narrow app on a wide viewport.

### Status

- **Warm warning** and **warning surface**: warning and warning-bg call attention to conflicts, pending work and time constraints.
- **Error red**: error marks inline failure and destructive activity actions.
- **Confirmed green**: confirmed is used for live connection presence and applied proposal results. Timeline confirmed states use the teal accent with a readable label.

**The State With Text Rule.** Confirmed, pending, offered and expired states retain readable labels; color never stands in for booking state or approval.

## Typography

**Interface font:** the system-first stack in the frontmatter. Apple system UI and PingFang precede the bundled Lounge Sans TC subset; Microsoft JhengHei and sans-serif complete the fallback. The local WOFF2 remains preloaded with font-display: swap and declared weights 400–600. The bundled font is a subset, so it does not establish complete CJK coverage. Its provenance remains in assets/fonts/README.md.

**Character:** direct, compact operational type with moderately weighted headings and open message leading. There is no separate display or mono face. The root uses tabular numerals, optical sizing and font-synthesis: none.

### Hierarchy

- **Title**: planner, assistant and sheet headings. The planner title becomes 20px at the narrow breakpoint.
- **Section**: itinerary and service-discovery headings.
- **Activity**: timeline and available-service names. Narrow timeline names become 15px; time values remain 16px with 1.65 line-height.
- **Body**: ordinary interface content.
- **Conversation**: message text with more open leading than the default body.
- **Label**: supporting flight information; other small hints use observed 10–13px contextual sizes rather than a universal forced label rhythm.
- **Field**: native sheet inputs/selects; the composer also uses 16px text with regular weight and 1.5 line-height.
- **Navigation**: icon-over-label tab items; the current destination changes to weight 600.

**The System First Rule.** Keep headings, forms and messages in the existing system-first stack. The local Lounge Sans TC subset is a fallback, not the primary visual identity.

## Layout

The application is a single vertical mobile panel, width min(100%,430px), with a 320px minimum document width and dynamic viewport height. Planner flight context stays above its scrolling content; the assistant keeps its header, compact live plan, composer and tab bar outside the scrolling message log. Safe-area insets participate in headers, tab bars and sheets. The app contains no simulated operating-system status bar.

The planner uses 24px horizontal insets. The assistant header uses 22px, messages 20px and composer 18px. Shared spacing uses the observed 4/8/12/16px rhythm; larger breaks separate task groups. The timeline grid uses 62px time / 10px node / flexible activity / 28px action columns, 14px gaps and a 94px minimum row height. A fine vertical line joins small teal nodes, and venue and state remain underneath the activity name. Save, time management and waitlist controls form a three-column contextual group after boarding information, with proportions 1 / 1 / 1.15.

Available-service rows pair a 112×120px object-fit: cover crop with text, slots and a right-aligned action. Source JPEGs are 450×300px. Four rows currently display shower, dining, massage and rest photographs; the fifth work photograph is present in the asset map for the existing work activity. The itinerary and conversation stay text-led.

Both screens share a three-column bottom bar: 我的行程, 智能助手, 突發修改. Each item has a 22px icon, 11px label and 50px minimum height. Three assistant quick controls sit above the composer: 重新優化, 貴賓室對比, 智能推薦. Together with itinerary and incident navigation, they retain all five existing assistant capabilities.

At widths of at least 560px, the app becomes a bordered preview panel with 24px corners, 20px outer vertical margins, height calc(100dvh - 40px) and a 940px maximum height. Sheets move 20px above the viewport bottom and round every corner. At widths up to 360px, planner and assistant insets reduce to 16px, timeline columns become 49px / 8px / flexible / 26px with 9px gaps, service crops become 88×112px, service text becomes one column, and sheet insets become 18px. Quick controls reduce their padding and labels to fit. Shared interactive controls have at least 44px height; context actions use 46px and sheet fields/actions 50px.

## Elevation & Depth

Depth comes primarily from white/sage/canvas layering, reply borders, separators and the modal backdrop. Ordinary timeline, service, comparison, recommendation and booking rows have no decorative shadow. The sheet backdrop is #18372c52; the sheet itself has no shadow.

### Shadow Vocabulary

- **Activity menu** (0 5px 26px #173d2821): separates an open native activity menu from the timeline.
- **Selected booking segment** (0 1px 3px #173d2810): lifts the selected white booking segment slightly from its canvas track.

**The Flat Reading Rule.** Keep timeline and service rows flat. Reserve the existing shadows for the open activity menu and selected booking segment.

## Shapes

Grouping is soft without turning every row into a card. Time context and the live-plan preview use 14px corners; assistant/user messages and proposal frames use 16px. Native fields, service photographs, activity menus, context controls and tab items share 12px corners. Filled sheet actions and boarding context use 13px. Compact booking/response actions and notices use 8–10px. Proposal tags use 4px; quiet text controls use 6px. The composer is a 28px-radius capsule, quick actions and microphone/send controls use 22px, and back/menu triggers are circular. Mobile task sheets have 26px upper corners and square lower corners.

## Components

### Buttons

Quiet text actions keep attention on content; filled teal is reserved for the next concrete confirmation. Sheet primary actions use 15px semibold type, 50px minimum height, full width and 12px 16px padding. Context controls have 46px minimum height, a fine border and 12px medium labels; save is the filled primary in that group. Booking and opportunity actions use 13px text and at least 44px height, with filled teal and white outlined variants. Text actions remain transparent with compact teal labels.

Fine-pointer hover adds sage to quiet controls or deepens filled teal actions. Press scales eligible buttons to 0.98. Disabled buttons use 0.45 opacity. Keyboard focus uses a 2px teal outline with 3px offset. Hover never changes the action's approval meaning.

### Time and Flight Context

The flight strip is open white content with a lower separator, a 17px semibold flight number, 14px destination and 12px boarding/gate context. A separate sage time overview uses 13px 15px padding, 14px corners and an inline edit action. A compact sage boarding strip closes the timeline. Time, flight and demo labels remain text rather than decorative metrics.

### Timeline and Activity Menu

Activity rows keep time, a small teal node, name/venue/state and a native details menu on one grid. The menu trigger is 44×44px, with a 148px minimum-width overlay, 5px inset and 44px menu items. Edit is ink; remove is error red. An open menu can move above its trigger to fit the scrolling viewport; only one stays open. Reorder mode replaces the menu with 44px up/down controls. Escape closes an open menu and returns focus to its summary.

### Service Rows and Photographs

Rows are flat, separated by a single line, with 17px vertical padding and 16px between the crop and text. Photographs have 12px corners. Names, location choices, slots, booking state and a contextual action remain separate. Real img elements provide descriptive alternatives, intrinsic dimensions, lazy loading and async decoding.

Use the five official JPEGs in assets/lounges: The Pier, First shower suites, massage service, day suites and The Bureau; The Wing, First Dining Room. The original image data is retained, with official source/copyright added as EXIF metadata. assets/lounges/sources.json records source URLs, subjects, dates and hashes; assets/lounges/README.md explains provenance. The visible credit links to both official lounge pages. Generated lounge-hero.png and lounge-scenes.png were removed. Photography does not change the selected venue, service eligibility or simulated booking inventory.

### Assistant Conversation

A compact white live-plan preview sits on canvas, with a horizontally scrollable miniature time sequence. The original filled four-point mark accompanies assistant messages. White replies have a fine border, 16px corners and 14px 16px padding. User messages use sage, the same corner radius, 12px 15px padding and at most 88% width. Message timestamps use muted 11px text. Proposal and booking-opportunity replies retain the same white framed material; plan rows inside them use separators instead of nested cards. Proposals expose a clear cancel/confirm pair and readable applied, cancelled, stale or failed results.

### Composer and Quick Actions

The white composer capsule has a fine separator-colored stroke that changes to teal on focus-within. Its text input has no separate outline; the containing border provides the focus cue. The 44px microphone is transparent and becomes sage while listening; the 44px send control is filled teal. Three outlined quick controls appear above it. Voice availability, listening and failure remain explicit text states. Enter, send, recognition and fallback retain the existing application behavior.

### Inputs and Task Sheets

Native inputs/selects have a white surface, field border, 12px corners, 12px 13px padding and 50px minimum height. Labels use 13px medium type and a 7px gap. Paired time fields use equal columns with a 12px gap. Inline errors use red text. Sheets use a slightly tinted white surface, a 32×4px handle, 21px title, 44px close control, 24px horizontal insets and at most 90dvh height. Content scrolls within the native modal dialog. Comparison, recommendation and task-choice content stays flat with separators.

### Navigation and Booking Views

The shared bottom bar uses equal columns, a fine top divider and a white surface. Inactive items use muted type and icons; aria-current="page" switches the active destination to semibold teal with a slightly stronger icon stroke. Incident entry remains an action without a false current-page state. Booking navigation is separate: three segments on canvas, with a selected white segment, small shadow and aria-pressed state. Booking filters and inventory diagnostics stay within their task sheet, and native disclosure preserves secondary detail.

### Tags, Notices and Feedback

Proposal-change tags are small sage rectangles with teal 11px labels and 3px 6px padding. They describe a change rather than act as interactive filters. Warnings use warm tonal grouping; confirmations retain readable state text. A compact dark toast floats above the current screen's fixed controls. Screen entry takes 220ms from 8px right with opacity 0.7; sheets take 280ms from 28px below with opacity 0.6. Control transitions take 160ms, toast transitions 180ms, and transform motion uses the existing cubic-bezier(.22, 1, .36, 1). Reduced-motion removes animation and transitions. Motion only marks a navigation, modal or feedback change.

## Do's and Don'ts

### Do:

- **Do** carry the user-selected films through white and sage surfaces, teal controls and the compact mobile hierarchy.
- **Do** keep time, activity, location and booking state distinct in the text-led timeline.
- **Do** use the same three tab-bar labels and selected treatment on planner and assistant screens.
- **Do** preserve all five assistant capabilities through the three quick actions and the itinerary and incident navigation controls.
- **Do** use the official photo files with descriptive alternatives, visible attribution and the existing provenance manifest.
- **Do** retain native fields, visible keyboard focus, safe-area spacing and the reduced-motion fallback.
- **Do** keep demonstration labels and proposal confirmation requirements explicit.

### Don't:

- **Don't** replace the selected visual world with the earlier bundled-font-first theme or generated lounge images.
- **Don't** put photographs into the itinerary or add decorative hero imagery, fake device status chrome or an unofficial airline logo.
- **Don't** turn save, time management or waitlist controls into persistent navigation destinations.
- **Don't** hide booking state behind color, or present a pending proposal, waitlist entry or offered slot as an approved reservation.
- **Don't** infer service eligibility, inventory or reservation rules from the photographed lounge.
- **Don't** add decorative shadows to ordinary rows or animate continuously around operational content.
