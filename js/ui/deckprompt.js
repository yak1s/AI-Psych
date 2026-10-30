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
  const n1 = names[0] || 'Name';
  const n2 = names[1] || 'any';
  const L = [];
  L.push(
    `You are the head writer for "AI Psych", a party game played on phones at a real get-together.`,
    ``,
    `# How the game works`,
    `Each round, a pretend "AI" shows a question about one or two of the players. Everyone secretly types a short made-up answer (funny, or suspiciously true), then everyone votes for the best answer. The people the question is about get a double vote. So a great question:`,
    `- is about specific players, by name;`,
    `- has no single correct answer — it invites invented answers;`,
    `- can be answered in a few words;`,
    `- makes the group laugh, or say "how does it know that?!"`,
    ``,
    `# Your task`,
    `Write ${f.count} questions for the group below. They should feel personal, as if the AI has been quietly watching this exact group.`,
    ``,
    `# The group (from the host — anything not mentioned is unknown; never invent serious facts)`,
  );
  if (f.occasion.trim()) L.push(`- Occasion, place and time: ${f.occasion.trim()}`);
  if (f.group.trim()) L.push(`- How everyone is connected: ${f.group.trim()}`);
  if (people.length) {
    L.push(`- Players:`);
    for (const p of people) L.push(`  - ${p.name.trim()}${p.about.trim() ? ` — ${p.about.trim()}` : ' — (no details given)'}`);
  } else L.push(`- Players: not listed. Use {any} and {any2} instead of names in every question.`);
  if (f.avoid.trim()) L.push(`- Off limits (never mention or hint at): ${f.avoid.trim()}`);
  if (!f.occasion.trim() && !f.group.trim() && !people.some((p) => p.about.trim()))
    L.push(`- No other details were given: write sharp, specific-sounding questions anyway, implying the AI has noticed things.`);
  L.push(
    ``,
    `# Names in questions`,
    `- Write each player's name in curly braces, spelled exactly as listed: {${n1}}. The game swaps in the name.`,
    `- Only people in the players list get curly braces. Anyone else mentioned above (a relative, a pet, a friend who isn't playing) is written normally, without braces.`,
    `- Every question must contain at least one {Name} or {any}.`,
    `- {any} = a random player; {any2} = a second, different random player. Use them in about 15% of the questions.`,
    `- About 20% of the questions involve two players together (e.g. {${n1}} and {${n2}}).`,
    `- Spread the questions evenly: every listed player appears about equally often, at every level.`,
    `- Repeat the name instead of using he/she/they, unless the details above make the pronoun clear.`,
    ``,
    `# Creepiness levels — exactly ${perLevel} questions per level`,
    `1. Innocent — playful warm-ups built on real details (hobbies, jobs, places, the occasion).`,
    `2. Curious — the AI starts noticing habits and little quirks.`,
    `3. Suspicious — the AI connects two details and draws a funny, slightly accusing conclusion.`,
    `4. Creepy — the AI seems to know private-feeling specifics: routines, the phone, what happens when nobody is watching.`,
    `5. "How do they know?!" — hyper-specific and eerie, as if the AI has been watching all along.`,
    ``,
    `# How to make them good`,
    `- Players with no details still get their share: use the occasion, the relationships, and playful invented specifics.`,
    `- Mine the details: each detail above should inspire several questions. Combine details (two hobbies, two people, a place plus a habit) and push them one step further into a funny "what really happens" scenario.`,
    `- Small, harmless, invented specifics make it feel real and creepy: "last Tuesday", "the second drawer", "at 2am", "the blue notebook".`,
    `- Vary the form: "What's the real reason…", "What did … whisper…", "What is … secretly…", "What would … never admit…", "Why does … always…", "What's hidden in …'s …", "What did … and … agree…". Don't start more than a quarter of the questions with the same word.`,
    `- One sentence (or a short set-up sentence plus the question), under 160 characters.`,
    `- The answer must be invented. Avoid questions with a factual answer ("What is {${n1}}'s favorite color?", "Where does {${n1}} live?").`,
    `- No "Who is most likely to…", no yes/no questions, no "would you rather", no lists, no multiple choice.`,
    `- Tone: warm teasing between people who like each other. Laugh with people, never at them. Nothing about weight, looks, money problems, health, relationship troubles, or anything off limits. Religion and culture can be the setting, never the punchline. Family-friendly unless the details clearly say otherwise.`,
    `- Levels 4–5 are creepy through precision and the feeling of being watched — never through violence, crime, darkness or real embarrassment. Some can start with "The AI noticed…".`,
    `- No corny puns, no generic icebreakers, no repeats or near-duplicates.`,
    ``,
    `# Examples (for a made-up group — don't reuse them)`,
    `- Level 1: "What would {Dad} name the GPS voice after it got him lost on the way to Grandma's?"`,
    `- Level 2: "What is {Kim} hoping to find every time {Kim} opens the fridge 'just to look'?"`,
    `- Level 3: "{Sarah} has been 'almost done' with the same puzzle for three months. What is really going on with that puzzle?"`,
    `- Level 4: "The AI noticed {Dad} always volunteers to take out the trash right after dinner. Where does {Dad} really go?"`,
    `- Level 5: "What did {Mom} and {Grandpa Joe} agree never to tell the rest of the family about the 2019 road trip?"`,
    `- Not like this: "What is {Mom}'s favorite food?" (has a real answer) · "Who is the funniest?" (names nobody) · "Would {Dad} rather swim or fly?" (a choice, nothing to invent).`,
    ``,
    `# Output`,
    `Reply with ONE JSON code block and nothing else — no introduction, no notes:`,
    '```json',
    JSON.stringify(
      {
        title: f.title.trim() || 'Our game night',
        players: names.length ? names : [],
        questions: [
          { level: 1, text: `What would {${n1}} …?` },
          { level: 5, text: `What did {any} and {${n2 === 'any' ? 'any2' : n2}} …?` },
        ],
      },
      null,
      2,
    ),
    '```',
    `- Valid JSON: double quotes, no comments, no trailing commas. "level" is a number from 1 to 5. List the questions in order of level.`,
    `- If everything doesn't fit in one reply, stop after a complete question and close the JSON properly; I'll ask you to continue.`,
    ``,
    `Before answering, check: ${f.count} questions, ${perLevel} per level, every {Name} spelled exactly as in "players", every question names someone, no near-duplicates, valid JSON.`,
  );
  if (f.language && !/^english$/i.test(f.language.trim())) L.push(``, `Write every question in ${f.language.trim()} (keep the JSON keys and the {Names} exactly as they are).`);
  return L.join('\n');
}

export function AiDeckHelper({ view, deckNames = [], onClose, onPaste, onTemplate }) {
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

  const head = html`<div class="seg ai-tabs" role="tablist">
    <button role="tab" class=${tab === 'write' ? 'on' : ''} onClick=${() => setTab('write')}>1. Describe & copy</button>
    <button role="tab" class=${tab === 'paste' ? 'on' : ''} onClick=${() => setTab('paste')} data-testid="ai-paste-tab">2. Paste the answer</button>
  </div>`;
  const foot =
    tab === 'write'
      ? html`<${Btn} block color="grape" onClick=${copy} testid="copy-prompt">${copied ? '✅ Copied! Paste it into your AI' : '📋 Copy the prompt'}<//>
          <div class="row" style="justify-content:space-between;gap:8px">
            <span class="muted small">Then copy the AI's whole reply into step 2.</span>
            ${onTemplate && html`<button class="link-btn" style="font-size:17px" onClick=${onTemplate}>📄 or download the template</button>`}
          </div>`
      : html`<${Btn} block color="mint" disabled=${!pasted.trim()} onClick=${() => onPaste(pasted)} testid="ai-paste-load">Load these questions<//>`;

  return html`<${Modal} big onClose=${onClose} title="✨ Make a deck with AI" head=${head} foot=${foot} testid="ai-modal">
    ${tab === 'write'
      ? html`<div class="stack ai-form" style="gap:10px" data-testid="ai-helper">
          <p class="muted small" style="margin:0">Everything is optional — but every detail you add makes the questions funnier and creepier. Then copy the prompt into ChatGPT, Gemini or Claude.</p>
          <label>Deck title
            <input class="input" value=${f.title} placeholder="e.g. Grandma's 80th" onInput=${(e) => set({ title: e.currentTarget.value })} />
          </label>
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
        </div>`
      : html`<div class="stack" style="gap:10px">
          <textarea class="input" rows="9" value=${pasted} placeholder="Paste the AI's whole answer here (the JSON)…" data-testid="ai-paste"
            onInput=${(e) => setPasted(e.currentTarget.value)}></textarea>
          <p class="muted small" style="margin:0">Answer cut off halfway? Paste it anyway — every complete question is kept. Or ask the AI to "continue", and paste everything.</p>
        </div>`}
  <//>`;
}
