# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Premium passengers planning lounge time before boarding or during a transfer. The user is building a four-person Cathay Hackathon prototype.

## Product Purpose

Help passengers plan lounge activities themselves or with an AI assistant, check simulated reservation inventory, join a waitlist and reconsider a plan when travel circumstances change.

## Stack

Existing vanilla HTML, CSS and JavaScript client; native Node.js 24 HTTP server; local SQLite reservation service; optional DeepSeek integration. GitHub Pages is a limited static demonstration and does not expose the database or live AI.

## Capabilities and Constraints

Preserve the current itinerary, manual activity editing, reordering, local persistence, membership/slot checks, reservation and waitlist confirmations, AI proposals, voice fallback, recovery validation, recommendation and lounge comparison behavior. This visual task does not replace the business layer or change flight/demo data. Itinerary inclusion and confirmed reservations remain separate states. A proposal requires explicit confirmation.

## Brand Commitments

The user explicitly selected the existing pitch-clips-v3 appearance: restrained Cathay-inspired white and light sage surfaces, dark teal actions, native mobile hierarchy, clear timelines, framed assistant replies and consistent bottom navigation. No official logo or slogan is requested. New photographs must be authentic Cathay lounge photographs, not the earlier generated assets and not newly generated images.

## Evidence on Hand

User-approved reference clips: ../../output/pitch-clips-v3. Current base: Ray1886/Cathay main at 2088c89526f0c559dd56fe42f321261d4f4bfa15. The supplied Cathay-main (4).zip matches the current main application files. Photo origins are documented in assets/lounges/sources.json.

## Product Principles

- Keep the passenger in control of booking and itinerary commitments.
- Preserve existing functionality while improving presentation and wayfinding.
- Keep confirmed, pending, offered and cancelled states explicit.
- Treat local data as prototype data; do not claim real airline integration.
