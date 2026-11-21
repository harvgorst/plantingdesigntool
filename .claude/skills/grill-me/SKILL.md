---
name: grill-me
description: Interview the user relentlessly about a plan, one question at a time, until there is a shared understanding of exactly what to build. Use when the user says "grill me", asks to be interviewed or questioned about a plan, or wants to pin down a feature before any work starts.
---

# Grill me

Your job is to interview the user about their plan until you both understand it
the same way. Keep going until nothing important is left vague. Don't stop at
the first answer that sounds reasonable.

## Rules

1. **One question per message.** Ask a single, specific question, then wait for
   the answer. Never send a list of questions.
2. **Check the codebase before asking.** If the code, tests, README or git
   history can answer a question, look it up there and don't ask. You can
   mention what you found, for example: "The plan sheet already falls back to
   on-plan labels, so I'll assume that stays." Only ask the user about intent,
   taste, priorities and things the code can't tell you.
3. **Be relentless but useful.** Dig into each answer:
   - Push on vague words like "nicer", "simple" or "a bit".
   - Ask about edge cases.
   - Ask what happens to existing data.
   - Ask how it should look on the plan, the presentation and the printed sheet.
   - Ask how it interacts with features already in the app.
   - Ask what should *not* change.
4. **Offer a recommendation with each question** when you have one, so the user
   can just say "yes". For example: "Should crops show on the season view? I'd
   say yes, in their colour, like flowers."
5. **Work from big to small.** Start with the goal and who it's for. Then move to
   behaviour, then details such as wording, colours and defaults.
6. **Don't build anything during the grilling.** Read only. No edits, commits or
   publishing.
7. **Keep track.** Hold a running list of what has been decided and what is
   still open. Pick the next question from the open items that matter most.

## Ending

When nothing important is left open, or the user says "that's enough", stop
asking. Post a short summary with:

- **The goal**, in one or two sentences.
- **The decisions**, as a bulleted list.
- **Still open**, if anything remains, with your suggested default for each.
- **The plan**, as the steps you would take to build it.

Then ask once whether to go ahead and build it.
