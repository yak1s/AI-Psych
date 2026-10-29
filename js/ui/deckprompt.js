// "Make a deck with AI": the host fills in a few (optional) details, copies a
// ready-made prompt into ChatGPT / Gemini / Claude, and pastes the answer back.

import { html, useState } from '../vendor/preact-htm.js';
import { Btn, Modal } from './common.js';
import { sfx } from './audio.js';
import { local } from '../storage.js';

const SAVE_KEY = 'aipsych.aiPromptForm';
const COUNTS = [60, 100, 150];

export function buildPrompt(f) {
  const people = f.people.filter((p) => p.name.trim());
  const perLevel = Math.round(f.count / 5);
  const names = people.map((p) => p.name.trim());
  const lines = [];
  lines.push(
    `You are the head writer of "AI Psych", a party game played on phones. Each round, an "AI" asks the group a question about one or two of the players. Everyone secretly writes a fake (funny or suspiciously true) answer, then everyone votes for their favorite answer. The person the question is about gets a double vote.`,
    ``,
    `Your job: write ${f.count} questions for this specific group — questions that feel like the AI knows them a little too well.`,
    ``,
    `## About the group (from the host)`,
  );
  if (f.occasion.trim()) lines.push(`- Occasion, place and time: ${f.occasion.trim()}`);
  if (f.group.trim()) lines.push(`- How everyone is connected: ${f.group.trim()}`);
  if (people.length) {
    lines.push(`- The players:`);
    for (const p of people) lines.push(`  - ${p.name.trim()}${p.about.trim() ? `: ${p.about.trim()}` : ''}`);
  } else lines.push(`- The players: not listed — use {any} and {any2} instead of names.`);
  if (f.avoid.trim()) lines.push(`- Off limits (never mention): ${f.avoid.trim()}`);
  if (!f.occasion.trim() && !f.group.trim() && !people.some((p) => p.about.trim()))
    lines.push(`- (No details were given. Write sharp, specific-sounding questions anyway — imply the AI has noticed things, without stating facts about anyone.)`);
  lines.push(
    ``,
    `## How the questions work`,
    `- Put player names in curly braces, spelled exactly as in the players list: {${names[0] || 'Name'}}. Every question must name at least one player this way.`,
    `- {any} means "a random player" and {any2} "a second, different random player". Use them for some questions so people who aren't listed get asked about too.`,
    `- About 1 in 5 questions should involve two players at once (e.g. {${names[0] || 'Name'}} and {${names[1] || 'any'}}).`,
    `- Spread the questions evenly across the players.`,
    `- One question per item, at most 200 characters, no line breaks, and no curly braces except around names.`,
    ``,
    `## Creepiness levels (exactly ${perLevel} questions per level)`,
    `1. Innocent — playful warm-ups built on a real detail (a hobby, a job, the trip, the occasion).`,
    `2. Curious — the AI starts noticing habits and little quirks.`,
    `3. Suspicious — the AI connects two details and draws a funny, slightly accusing conclusion.`,
    `4. Creepy — the AI seems to know private-feeling specifics: routines, the phone, what happens when nobody is watching.`,
    `5. "How do they know?!" — hyper-specific and eerie, as if the AI has been watching all along. Creepy through precision, never through darkness, violence or anything truly embarrassing.`,
    ``,
    `## What makes a great question`,
    `- Open-ended prompts that invite a funny invented answer: "What…", "Why…", "What's the real reason…", "What did… whisper…", "What would… never admit…". No yes/no, no multiple choice, no "Who is most likely to…".`,
    `- Built on the details above — and extrapolate: combine two facts, imagine what happens behind the scenes, take a known habit one step further. Specific beats general. Use the occasion and places as the setting for some questions.`,
    `- For levels 4–5, some questions can be phrased as something the AI "noticed" ("The AI noticed {Name}…"). That's where the "how does it know that?!" moments come from.`,
    `- Vary the wording; don't start every question the same way.`,
    `- Affectionate teasing only: laugh with people, never at them. Nothing about weight, looks, money troubles, health, or anything listed as off limits. Treat religion, culture and family with respect (they can be the setting, never the joke).`,
    `- Family-friendly unless the host's details clearly say otherwise.`,
    `- Use names instead of pronouns when you're not sure of someone's pronouns.`,
    `- Avoid corny puns, generic icebreakers ("What's your favorite color?") and questions with one correct answer.`,
    ``,
    `Examples of the right style (the details are made up):`,
    `- Level 1: "What would {Dad} name the GPS voice after it got him lost on the way to Grandma's?"`,
    `- Level 3: "{Sarah} has been 'almost done' with the same puzzle for three months. What is really going on with that puzzle?"`,
    `- Level 4: "The AI noticed {Dad} always volunteers to take out the trash right after dinner. Where does {Dad} really go?"`,
    `- Level 5: "What did {Mom} and {Grandpa Joe} agree never to tell the rest of the family about the 2019 road trip?"`,
    `Not like this: "What is {Mom}'s favorite food?" (has a real answer, nothing to invent) or "Who is the funniest?" (no player named).`,
    ``,
    `## Output format`,
    `Reply with ONE JSON code block and nothing else. It must be valid JSON (double quotes, no comments, no trailing commas), exactly in this shape:`,
    '```json',
    JSON.stringify(
      {
        title: f.title.trim() || 'Our game night',
        players: names.length ? names : ['Name 1', 'Name 2'],
        questions: [
          { level: 1, text: `What would {${names[0] || 'Name 1'}} …?` },
          { level: 5, text: `What did {any} and {${names[1] || 'Name 2'}} …?` },
        ],
      },
      null,
      2,
    ),
    '```',
    `Before answering, check: ${f.count} questions in total, ${perLevel} per level, every {Name} spelled exactly as in "players", every question names at least one player, and the JSON is valid.`,
  );
  if (f.language && f.language !== 'English') lines.push(``, `Write all questions in ${f.language}. Keep the JSON keys in English.`);
  return lines.join('\n');
}

export function AiDeckHelper({ view, deckNames = [], onClose, onPaste }) {
  const initialPeople = () => {
    const names = [...new Set([...deckNames, ...view.players.map((p) => p.name)])];
    return (names.length ? names : ['', '', '']).map((name) => ({ name, about: '' }));
  };
  const [f, setF] = useState(() => {
    const saved = local.get(SAVE_KEY);
    const base = { title: '', occasion: '', group: '', avoid: '', language: 'English', count: 100, people: initialPeople() };
    if (!saved) return base;
    // keep what was typed last time, add anyone new
    const people = [...saved.people];
    for (const p of base.people) if (p.name && !people.some((x) => x.name.trim().toLowerCase() === p.name.toLowerCase())) people.push(p);
    return { ...base, ...saved, people };
  });
  const [copied, setCopied] = useState(false);
  const [pasted, setPasted] = useState('');
  const [tab, setTab] = useState('write');
  const set = (patch) => {
    const next = { ...f, ...patch };
    setF(next);
    local.set(SAVE_KEY, next);
  };
  const setPerson = (i, patch) => set({ people: f.people.map((p, j) => (j === i ? { ...p, ...patch } : p)) });
  const prompt = buildPrompt(f);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = prompt;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    setCopied(true);
    sfx('pop');
    setTimeout(() => setCopied(false), 2200);
  };

  return html`<${Modal} onClose=${onClose} title="✨ Make a deck with AI">
    <div class="seg" role="tablist" style="margin-bottom:12px">
      <button role="tab" class=${tab === 'write' ? 'on' : ''} onClick=${() => setTab('write')}>1. Describe & copy</button>
      <button role="tab" class=${tab === 'paste' ? 'on' : ''} onClick=${() => setTab('paste')} data-testid="ai-paste-tab">2. Paste the answer</button>
    </div>
    ${tab === 'write'
      ? html`<div class="stack ai-form" style="gap:10px" data-testid="ai-helper">
          <p class="muted small" style="margin:0">Everything is optional — but every detail you add makes the questions funnier and creepier. Then copy the prompt into ChatGPT, Gemini or Claude.</p>
          <label>What's the occasion? Where & when?
            <input class="input" value=${f.occasion} placeholder="e.g. Saturday-night family dinner after Leo's graduation, in Lisbon" onInput=${(e) => set({ occasion: e.currentTarget.value })} />
          </label>
          <label>How is everyone connected?
            <textarea class="input" rows="2" value=${f.group} placeholder="e.g. Three siblings, their spouses and the grandparents. Ana and Leo are twins." onInput=${(e) => set({ group: e.currentTarget.value })}></textarea>
          </label>
          <div class="stack" style="gap:6px">
            <b>The players <span class="muted small">— a few words each: job, hobbies, quirks, where they live, recent news, inside jokes</span></b>
            ${f.people.map((p, i) => html`<div key=${i} class="ai-person">
              <input class="input" value=${p.name} placeholder="Name" aria-label="Name" onInput=${(e) => setPerson(i, { name: e.currentTarget.value.replace(/[{}]/g, '') })} />
              <input class="input" value=${p.about} placeholder="e.g. just moved to Florida, bakes at 2am, ignores group chats" aria-label=${`About ${p.name || 'this player'}`} onInput=${(e) => setPerson(i, { about: e.currentTarget.value })} />
              <button class="link-btn" aria-label="Remove" onClick=${() => set({ people: f.people.filter((_, j) => j !== i) })}>✕</button>
            </div>`)}
            <button class="link-btn" style="align-self:flex-start" onClick=${() => set({ people: [...f.people, { name: '', about: '' }] })}>+ add a player</button>
          </div>
          <label>Anything off limits?
            <input class="input" value=${f.avoid} placeholder="e.g. no politics, don't mention the divorce" onInput=${(e) => set({ avoid: e.currentTarget.value })} />
          </label>
          <div class="row" style="justify-content:space-between">
            <label class="row" style="gap:6px">Questions
              <select value=${f.count} onChange=${(e) => set({ count: Number(e.currentTarget.value) })}>${COUNTS.map((n) => html`<option key=${n} value=${n}>${n}</option>`)}</select>
            </label>
            <label class="row" style="gap:6px">Language
              <input class="input" style="width:120px" value=${f.language} onInput=${(e) => set({ language: e.currentTarget.value })} />
            </label>
          </div>
          <details><summary class="muted small">See the prompt</summary><pre class="prompt-preview">${prompt}</pre></details>
          <${Btn} block color="grape" onClick=${copy} testid="copy-prompt">${copied ? '✅ Copied! Now paste it into your AI' : '📋 Copy the prompt'}<//>
          <p class="muted small" style="margin:0">When the AI answers, copy its whole reply and come back to step 2.</p>
        </div>`
      : html`<div class="stack" style="gap:10px">
          <textarea class="input" rows="9" value=${pasted} placeholder="Paste the AI's whole answer here (the JSON)…" data-testid="ai-paste"
            onInput=${(e) => setPasted(e.currentTarget.value)}></textarea>
          <${Btn} block color="mint" disabled=${!pasted.trim()} onClick=${() => onPaste(pasted)} testid="ai-paste-load">Load these questions<//>
          <p class="muted small" style="margin:0">Tip: a longer answer cut off halfway? Ask the AI to "continue the JSON", or ask for fewer questions.</p>
        </div>`}
  <//>`;
}
