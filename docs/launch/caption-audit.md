# Starter Captions Audit — 2026-04-22T15:34:31.474Z

Heuristic scan of `data/starter-captions.json`. This report is advisory — it **flags candidates for human review**, never modifies data. The only hard gate on launch is your manual sign-off (see `docs/launch/v1.0-checklist.md`).

## Heuristics

| ID | What it catches | Verdict if hit |
|---|---|---|
| H1 | Any contiguous 4-token overlap between caption and shabad translation (stricter than the runtime 7-token guard). | fail |
| H2 | Caption contains a quoted run of >=3 tokens (double or single quotes). | review |
| H3 | >=5 content tokens from caption appear in order inside the translation (paraphrase signal). | fail |
| H4 | Caption contains a Gurmukhi codepoint (U+0A00–U+0A7F). Runtime guard should prevent this; defensive flag. | fail |
| (marker) | Caption is a guard-marker (`explanation: null`) — no prose to review, only worth noting. | marker |

## Summary

- Total captions: **100**
- Pass: **78**
- Review: **0**
- Fail: **13**
- Guard markers (no prose to review): **9**

## Failures — review urgently (13)

| Query | Shabad | Triggers | Explanation | Notes |
|---|---|---|---|---|
| anger | 3600 | H1 | The shabad touches on the poison of anger and its remedy through contemplation of the Lord. | contiguous 4-gram shared with translation: "contemplation of the lord" |
| seva | 1645 | H3 | The shabad touches on performing God's service to gather profit and obtain honor. | loose paraphrase signal (5+ ordered tokens from translation): "god s service gather profit obtain" |
| ego | 1706 | H1 | This shabad explores the nature of ego and its removal. | contiguous 4-gram shared with translation: "the nature of ego" |
| ego | 2230 | H1 | This shabad mentions the Enemy of ego, implying a connection to overcoming ego. | contiguous 4-gram shared with translation: "the enemy of ego" |
| ego | 343 | H1, H2 | This shabad discusses the removal of ego's filth through the Guru's gospel | contiguous 4-gram shared with translation: "the guru s gospel"; contains quoted run of >=3 tokens: "s filth through the Guru" |
| ego | 4625 | H1 | This shabad touches on ego as something to be stilled and overcome, with the Lord's Name as a remedy. | contiguous 4-gram shared with translation: "the lord s name" |
| devotion | 2648 | H1 | This shabad expresses devotion through the love of the Lord and the service of the Guru. | contiguous 4-gram shared with translation: "the love of the" |
| devotion | 340 | H1 | This shabad explores the concept of devotion through service and remembrance of the Lord's Name. | contiguous 4-gram shared with translation: "the lord s name" |
| devotion | 175 | H3 | This shabad emphasizes the importance of devotion to God, attained through the Guru's guidance and the Name. | loose paraphrase signal (5+ ordered tokens from translation): "god attained through guru s" |
| fear | 2668 | H1 | This shabad expresses a personal struggle with the fear of death and seeking refuge in the Lord. | contiguous 4-gram shared with translation: "the fear of death" |
| fear | 451 | H1 | This shabad explores the concept of fear, specifically the fear of God, as a means to overcome other fears, including the fear of death. | contiguous 4-gram shared with translation: "the fear of death" |
| love | 1131 | H1 | This shabad touches on the love of the Divine Beloved. | contiguous 4-gram shared with translation: "the love of the" |
| doubt | 1588 | H1 | This shabad addresses overcoming doubt through meditation and the Name's love. | contiguous 4-gram shared with translation: "and the name s" |

## Review candidates (0)

_None._

## Guard markers (no prose to review) (9)

| Query | Shabad | Triggers | Explanation | Notes |
|---|---|---|---|---|
| love | 958 | provider-error | (null — guard marker) | guard marker (source=guard, trigger=provider-error) |
| truth | 2888 | provider-error | (null — guard marker) | guard marker (source=guard, trigger=provider-error) |
| truth | 1178 | provider-error | (null — guard marker) | guard marker (source=guard, trigger=provider-error) |
| truth | 1159 | provider-error | (null — guard marker) | guard marker (source=guard, trigger=provider-error) |
| truth | 1138 | provider-error | (null — guard marker) | guard marker (source=guard, trigger=provider-error) |
| truth | 74 | provider-error | (null — guard marker) | guard marker (source=guard, trigger=provider-error) |
| truth | 337 | provider-error | (null — guard marker) | guard marker (source=guard, trigger=provider-error) |
| truth | 1715 | provider-error | (null — guard marker) | guard marker (source=guard, trigger=provider-error) |
| truth | 422 | provider-error | (null — guard marker) | guard marker (source=guard, trigger=provider-error) |

## Passes (heuristic clean) (78)

<details><summary>Expand list</summary>

| Query | Shabad | Triggers | Explanation | Notes |
|---|---|---|---|---|
| anger | 2519 | - | The shabad touches on the theme of anger as a spiritual obstacle. |  |
| anger | 1408 | - | The shabad touches on the theme of violence and its effects, which can evoke anger. |  |
| anger | 3722 | - | This shabad touches on the theme of inner enemies, including anger, that obscure the mind. |  |
| anger | 94 | - | This shabad touches on the theme of anger and its relation to self-conceit. |  |
| anger | 73 | - | This shabad touches on the theme of desire and anger, and how they can be quenched by remembering God's Name. |  |
| anger | 1338 | - | The shabad touches on anger as a destructive force |  |
| anger | 144 | - | This shabad touches on the destructive nature of inner enemies like anger. |  |
| anger | 3417 | - | The shabad addresses adversaries like anger and ego, and how to overcome them. |  |
| anger | 3607 | - | This shabad touches on not entertaining anger in the mind |  |
| seva | 40 | - | This shabad touches on the idea of devotion and praise, which is related to the concept of seva. |  |
| seva | 4237 | - | It touches on serving the Lord, which aligns with the theme of seva. |  |
| seva | 4611 | - | This shabad touches on the Lord's role in guiding beings toward virtuous deeds, which relates to the concept of seva. |  |
| seva | 1774 | - | The shabad touches on selfless service through the metaphor of spiritual practices. |  |
| seva | 1729 | - | This shabad touches on the idea that true virtues come from within, like sweetness and humility, which is related to the concept of selfless service. |  |
| seva | 2517 | - | The shabad touches on the idea of a single, unified reality, which can be related to the concept of selfless service to all, as the Lord is seen in every heart. |  |
| seva | 212 | - | This shabad touches on devotion and meditation, which can be related to the concept of seva. |  |
| seva | 1643 | - | This shabad touches on the idea of selfless service and devotion, which is related to the concept of seva. |  |
| seva | 1411 | - | This shabad touches on the idea of spiritual growth through union with the Lord, which can be facilitated by selfless service and guidance from the Guru. |  |
| ego | 2155 | - | This shabad explores the conflict between ego and devotion to the divine |  |
| ego | 4886 | - | This shabad discusses the negative effects of ego and the importance of overcoming it to attain spiritual growth. |  |
| ego | 4060 | - | This shabad touches on ego as an enemy of spiritual growth, and the importance of remembering God's Name to overcome it. |  |
| ego | 5124 | - | This shabad highlights the destructive nature of ego |  |
| ego | 1093 | - | This shabad discusses the importance of letting go of ego |  |
| ego | 5514 | - | This shabad touches on the issue of ego and its persistence despite efforts to overcome it. |  |
| death | 5351 | - | This shabad touches on the theme of death and its consequences |  |
| death | 4997 | - | This shabad reflects on the inevitability of death and the importance of dying in a way that transcends rebirth. |  |
| death | 5194 | - | This shabad touches on the theme of mortality |  |
| death | 5511 | - | This shabad mentions death in the context of spiritual neglect |  |
| death | 2927 | - | This shabad touches on the inevitability of death and its impact on one's life |  |
| death | 5308 | - | This shabad reflects on the inevitability of death and its consequences |  |
| death | 4990 | - | This shabad reflects on death as a transformative state leading to supreme bliss. |  |
| death | 5506 | - | This shabad mentions death in relation to spiritual neglect |  |
| death | 2627 | - | This shabad reflects on the inevitability of death and the importance of spiritual focus amidst mortality. |  |
| death | 428 | - | This shabad discusses the inevitability of death and its relation to spiritual life. |  |
| devotion | 474 | - | This shabad explores the nature of true devotion and its significance in spiritual growth. |  |
| devotion | 323 | - | This shabad explores the theme of devotion to the One Lord, highlighting its importance in achieving spiritual bliss and liberation. |  |
| devotion | 1420 | - | This shabad explores the nature of true devotion and its significance in spiritual growth. |  |
| devotion | 2650 | - | This shabad emphasizes cultivating devotion to God's Name |  |
| devotion | 258 | - | This shabad explores the concept of devotion and its rewards. |  |
| devotion | 1680 | - | This shabad explores the theme of devotion to the Lord, highlighting its importance in spiritual growth. |  |
| devotion | 177 | - | This shabad touches on devotion as a product of Divine knowledge and a means to attain spiritual bliss. |  |
| forgiveness | 2478 | - | It touches on divine forgiveness and the release from past wrongs |  |
| forgiveness | 708 | - | This shabad touches on forgiveness as a key aspect of spiritual growth and emancipation. |  |
| forgiveness | 5123 | - | It touches on forgiveness as a path to the Divine presence. |  |
| forgiveness | 2617 | - | The shabad touches on divine forgiveness as a means of salvation for the sinner. |  |
| forgiveness | 4849 | - | This shabad touches on divine forgiveness and union with the Lord |  |
| forgiveness | 5332 | - | The shabad mentions forgiveness as a virtue |  |
| forgiveness | 3041 | - | The shabad touches on seeking forgiveness from the Lord |  |
| forgiveness | 4837 | - | It touches on forgiveness as a desired virtue and a gift from the Lord. |  |
| forgiveness | 2403 | - | It touches on divine forgiveness and the mortal's need for it. |  |
| forgiveness | 4477 | - | It touches on forgiveness as a spiritual practice, like a rosary, which aligns with the theme of forgiveness. |  |
| fear | 3802 | - | This shabad touches on fear as a natural response to the world's challenges, yet finds solace in the Lord. |  |
| fear | 4670 | - | This shabad explores the concept of fear as a means to attain spiritual growth and salvation. |  |
| fear | 2943 | - | This shabad explores the role of fear in devotion |  |
| fear | 441 | - | This shabad explores the concept of fear and its impact on human life, highlighting the distinction between worldly fear and fear of the Lord. |  |
| fear | 1696 | - | This shabad explores the concept of fear as a universal force that governs all creation. |  |
| fear | 5513 | - | This shabad addresses the fear of death that persists across many births. |  |
| fear | 3681 | - | This shabad explores the concept of fear in relation to the Lord, describing how all creation is in His fear, except the Lord Himself. |  |
| fear | 5039 | - | This shabad touches on overcoming fear, specifically the fear of death, through a sense of acceptance and surrender. |  |
| love | 786 | - | This shabad touches on the effacement of love for another |  |
| love | 1520 | - | This shabad explores the transformative power of the Lord's love. |  |
| love | 4595 | - | This shabad explores the depth of love for the Divine Beloved. |  |
| love | 5235 | - | This shabad expresses a longing to nurture love through spiritual connection |  |
| love | 198 | - | This shabad touches on experiencing God's love |  |
| love | 1276 | - | This shabad touches on loving the one Beloved |  |
| love | 1048 | - | This shabad expresses the joy of loving devotion to God. |  |
| love | 4931 | - | This shabad touches on loving the Lord, aligning with the theme of love. |  |
| doubt | 839 | - | This shabad addresses doubt as a primary obstacle to spiritual growth. |  |
| doubt | 5170 | - | This shabad touches on the theme of doubt, mentioning its presence among scholars and adepts. |  |
| doubt | 522 | - | This shabad addresses the theme of doubt and its resolution through faith in the all-pervading Lord. |  |
| doubt | 1367 | - | This shabad touches on the theme of doubt and its persistence in the mind, and the search for a way to dispel it. |  |
| doubt | 75 | - | This shabad addresses the issue of doubt and its resolution through the Guru's guidance. |  |
| doubt | 3205 | - | This shabad touches on the theme of doubt and its removal through the Guru's guidance. |  |
| doubt | 1990 | - | This shabad addresses the demolition of doubt by the True Guru. |  |
| doubt | 1677 | - | This shabad touches on the theme of doubt as a spiritual obstacle and the importance of seeking refuge in the Lord to overcome it. |  |
| doubt | 642 | - | This shabad touches on the theme of doubt and its removal through meeting the Master with the Guru's guidance. |  |
| truth | 2168 | - | This shabad emphasizes the importance of truth in achieving spiritual growth and union with God. |  |
| truth | 1710 | - | This shabad explores the concept of truth and its attainment through the True Guru. |  |

</details>

---

Heuristics are deliberately conservative. A "fail" here is **not proof** that a caption paraphrases scripture — it means the caption shares enough surface with the translation to warrant a human read. The R8 hard gate (README / v1.0 plan §U13) requires you to personally sign off on every caption before launch.
