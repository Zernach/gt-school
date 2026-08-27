# Part 2 — Coding

Estimated delivery: 1–2 minutes at a conversational pace.

## Screen 1 — Behind the curtain: a blank repo

On screen: Show the repository structure and the bootstrap command or its resulting files.

Voiceover: “And now, a peek behind the curtain. At the beginning, there wasn’t a grand machine—just an empty repo and a to-do list looking slightly too tall. I ran my custom `bootstrap` command from my machine’s zprofile. It laid out the folders, Compose patterns, test commands, agent guardrails, and the prompt journal. Nothing flashy; just giving the work somewhere sensible to stand.”

## Screen 2 — The brief gets a map

On screen: Show `@docs/REQUIREMENTS.md`, `@docs/RESEARCH.md`, and `@docs/BOOTSTRAP.md`.

Voiceover: “Next, the brief gets a map. I turned the requirements PDF into Markdown, because searchable breadcrumbs beat a very long scroll. I asked the coding agents for research, then used that research to shape a one-shot implementation prompt. The docs became the map before the code took a lap.”

## Screen 3 — Welcome the connected pieces

On screen: Show the architecture diagram, then the frontend, API, worker, database, and queue in the repository.

Voiceover: “Please welcome the connected pieces: browser to API, API to Postgres, worker to sync, check, and propose. The source adapters only read. Postgres keeps the durable record; Redis carries the message. A proposal waits for a reviewer. The short version is: read it, check it, show it—don’t quietly rewrite it.”

## Screen 4 — The small-table makeover

On screen: Show the dashboard and the final screen order.

Voiceover: “The first pass felt like it had brought too many chairs to a small table. So here comes the small-table makeover. I simplified the experience around the work a reviewer actually does: start with evidence, find the disagreement, follow the trail, record the decision. Fewer detours. Same careful bits.”

## Close — That’s the show

On screen: Leave the final dashboard view or the architecture diagram visible.

Voiceover: “And that’s the show: a blank repo, a careful map, a connected slice, and then a shorter path through the screen. No trumpet needed. The rhyme is: check, explain, leave a trail—and let the human choose the next detail.”
