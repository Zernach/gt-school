---
name: gt-school-stakeholder-scripts
description: Draft spoken, slide-by-slide presentation narration for GT School stakeholders, translating technical software work into clear education outcomes with a warm, humble, intelligent, lightly witty voice.
---

# GT School Stakeholder Scripts

Use this skill when writing or revising a presentation talk track, speaker notes,
demo narration, executive update, product walkthrough, or decision brief for GT
School. It is for spoken narration accompanying a presentation; it is not a
replacement for slide design, technical documentation, or marketing claims.

## Audience lens

Treat the default audience as mixed, with most listeners non-technical and a
smaller group interested in implementation detail. GT School is an education
organization, so explain software through the people and learning outcomes it
serves: students, families, educators, guides, school leaders, and the wider
learning community. Technology is the means, not the hero.

Use GT School's public positioning as context when it is relevant: gifted K–8
learners, mastery before progression, accelerated learning, real-world
application, and a supportive community. Verify current program names, metrics,
and claims against the user's source materials or [gt.school](https://www.gt.school)
when they matter. Do not invent an initiative, result, stakeholder priority, or
education outcome merely because it sounds aligned with that positioning.

## Voice

The speaker should sound like a thoughtful teammate who respects the audience's
time and intelligence:

- **Likable:** conversational, direct, generous with credit, and easy to listen
  to. Use “we” when the team genuinely shares ownership and “you” sparingly,
  without sounding salesy.
- **Humble:** separate what is known, observed, estimated, proposed, and still
  unknown. Name tradeoffs and limitations without becoming defensive.
- **Kind:** make complexity feel navigable. Never make a non-technical listener
  feel behind, and never use students, families, educators, or colleagues as the
  butt of a joke.
- **Intelligent:** make the reasoning visible. Explain cause and effect, use
  concrete examples, and preserve the important nuance behind a simple claim.
- **Witty:** add occasional, low-risk observational humor or a memorable turn
  of phrase. Keep it brief and warm; never use sarcasm, snark, hype, or a joke
  where a caveat or a child's experience deserves care.

Aim for “clear enough to repeat after the meeting.” Prefer short spoken
sentences, active verbs, natural contractions, and concrete nouns. Write for an
ear, not a page: vary sentence length, include purposeful pauses, and avoid
stacking three abstract nouns in a row.

## Narration method

Before drafting, identify the presentation's audience, decision or outcome,
available time, slide order, required ask, and evidence supplied by the user.
If one of these is missing, make a reasonable assumption and label it briefly;
ask a question only when the missing detail would materially change the script.

Build one throughline:

1. Start with the shared educational purpose or a recognizable human problem.
2. State what is changing in plain language and why it matters now.
3. Show how the solution works, introducing technical detail only after the
   listener understands the benefit.
4. Connect the mechanism to a student, family, educator, or school-operations
   experience.
5. Give evidence, tradeoffs, risks, and what remains to be learned.
6. End with a specific decision, response, introduction, or next step.

For each technical concept, use this order:

> Plain-language meaning → education or operational consequence → optional
> technical name or detail.

For example, explain “the system retries a failed job safely” as “if a service
temporarily loses connection, the work can resume without creating a duplicate
student record”; only then mention idempotency or retry bounds if useful. Define
an unavoidable term once, then use it consistently. Put implementation detail
that does not change the stakeholder decision into an optional appendix or
Q&A note.

## Claims and care

Preserve source fidelity. Do not turn a target into a result, a prototype into
production readiness, or a local test into proof that families or educators have
benefited. Use explicit labels such as “today,” “in pilot,” “proposed,” “we
observed,” “we expect,” and “we still need to validate.” Keep student and family
stories anonymized unless the user supplied permission and attribution.

When discussing failure, cost, privacy, accessibility, or uncertainty, be candid
and constructive: explain the safeguard, the remaining risk, and the practical
next step. Avoid blame-oriented language and avoid promising that technology
will solve a motivation, teaching, or learning problem by itself.

## Default output shape

Unless the user requests another format, begin with a compact framing block and
then provide a slide-by-slide talk track:

```text
Presentation throughline: <one sentence>
Audience and goal: <who should understand or decide what>
Estimated delivery: <minutes, based on roughly 130–150 spoken words per minute>
Stakeholder ask: <the concrete next step>

Slide 1 — <title>
Narration: <spoken paragraph, usually 45–120 words>
Bridge: <one sentence that earns the next slide>
Optional detail: <technical or evidence note for Q&A, only when useful>
```

Adjust narration length to the requested duration and number of slides. Do not
read the slide verbatim: let the slide carry labels and simple facts while the
narration supplies meaning, context, and movement. Use `[VERIFY: ...]` for a
material claim that lacks source support instead of filling the gap with an
invented detail.

## Final pass

Read the script aloud mentally or literally and revise anything that sounds
like a memo. Check that:

- the first minute makes the educational relevance clear;
- every technical term earns its place and is translated before use;
- humor is optional, kind, and never aimed at a person or group;
- claims distinguish evidence from aspiration and include meaningful caveats;
- transitions explain why the next slide follows;
- the ask is concrete and the ending is confident without overselling; and
- the total spoken word count fits the requested time.
