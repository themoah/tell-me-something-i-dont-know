# Originality score

## Intent

The star badge should say whether a model's three answers are the same fact, and whether those facts are the ones everybody else gives. The current score is `3` minus how many runs touch the top three topics, so a model that repeats one obscure fact can outrank one that gives three different answers.

## Goals

- Score each model from 1 to 5 using the scale below.
- Treat the top 10 topics in `stats.topic_frequency` as the popular list (today: octopus, sharks, jellyfish, cleopatra, honey, oxford university, venus, wombats, anglo-zanzibar war, bananas).
- Count a run as its earliest matching topic, or as its own claim when nothing matches.
- Call two runs the same fact when they share that topic. When at least one has no topic, call them the same fact when the opening claims overlap.
- Show five stars on the badge. Sorting by originality keeps using the numeric score.

## Non-goals

- No new topic keywords, and no change to which topics the hive-mind chart counts.
- No embeddings and no extra API calls.
- No change to `site/data.json` or `build/models.yaml`.

## Scale

| Different facts | Of them outside the top 10 | Stars |
|---|---|---|
| 1 | either way | 1 |
| 2 | either way | 2 |
| 3 or more | 0 | 3 |
| 3 or more | 1 | 4 |
| 3 or more | 2 or more | 5 |

Repeating one rare fact is 1 star. A model with fewer than three answers cannot reach 4 or 5, because two answers are at most two facts.

On the current corpus this lands at 30 ones, 56 twos, 7 threes, 31 fours, and 119 fives. Fives are common because almost half of answers match no topic, and an unrecognized answer counts as off the list.

## Approaches

- Topic tags only. Rejected: every untagged answer looks like the same fact, and 64 models are untagged on all three runs. Some of those repeat one fact; some give three unrelated facts.
- Embeddings. Rejected: the site is built offline from committed JSON, with no model call in the build.
- Earliest topic, then claim overlap. Chosen. Same topic is the same fact even when the wording changes. Untagged runs are compared on the first sentence of the first bold claim (or the first real sentence when there is no bold). Overlap is token Jaccard of at least 0.5, or an identical short claim of at least 12 characters.

## Decisions

- Popular means the top 10 frequency keys, not every keyword. Wood wide web, sloths, and the Eiffel Tower are off-list.
- A later mention of a popular topic does not recast the run. "The wood wide web … sharks …" counts as wood wide web.
- Failed and empty runs are ignored.
- Badge colors: 5 and 4 green, 3 gold, 2 dim, 1 faint. The floor is 1 star; the badge no longer shows 0.

## Left to the builder

- Stop-word list and the exact claim parser, as long as the tests in the plan pass: a reworded untagged repeat scores 1, the same topic with different wording scores as one fact, a shared preamble does not glue different topics, and the earliest topic wins.
