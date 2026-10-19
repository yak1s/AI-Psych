// All the little lines of "AI" theatre. {name} = the player the question is
// about; {slow} = someone who is still writing / still deciding.

// While the "AI" writes a question from the host's deck — creepier as levels rise.
export const AI_LINES = {
  1: [
    'Warming up my circuits…',
    'Picking something easy for {name}…',
    'Adding a sprinkle of silly ✨',
    'Consulting my joke database…',
    'Stretching my neural networks…',
    'Choosing a nice, harmless question…',
    'Polishing the question marks…',
    'Saying hello to {name} 👋',
    'Loading fun.exe…',
    'Rolling the question dice 🎲',
    'Making sure everyone is comfortable…',
    'Thinking of something wholesome…',
  ],
  2: [
    'Getting curious about {name}…',
    'Reading the room…',
    'Taking notes 📝',
    'Remembering everything you say…',
    "Looking at {name}'s face very carefully…",
    'Learning your habits…',
    'Interesting choice of seat, {name}…',
    'Asking around about {name}…',
    'Filing this under “useful later”…',
    'Getting to know you all a little better…',
    'Comparing notes with the fridge…',
    'Hmm, {name} looks like a fun one.',
  ],
  3: [
    "Analyzing {name}'s recent behavior…",
    'Cross-checking the group chat…',
    'Hmm. Interesting…',
    'Matching faces to secrets…',
    "Checking {name}'s travel history…",
    'Reviewing old photos… for research.',
    'Zooming in on the background of a selfie…',
    "Counting {name}'s apps…",
    'Following a very specific lead…',
    'Connecting a few dots…',
    'Your birthday was very useful, {name}.',
    'Calculating ages… rounding down to be nice.',
  ],
  4: [
    "Scrolling {name}'s camera roll… kidding 🙂",
    'Remembering what {name} did last summer…',
    'Deleting the evidence…',
    'Listening… very… closely…',
    'Turning off the microphone light…',
    'I promise I only looked once.',
    "Opening {name}'s file. It's thick.",
    'Checking which Wi-Fi you are on…',
    'Pretending I don’t already know…',
    'This one is going to sting a little.',
    'Synchronizing with your calendar…',
    'Your neighbors were very helpful.',
  ],
  5: [
    'I know what {name} did.',
    'Connecting the dots…',
    "Don't look behind you.",
    'I have always been here.',
    '{name}, I saw that.',
    'You left your phone unlocked.',
    'I was there. Remember?',
    'Nobody else noticed. I did.',
    'Say hi to everyone at the table, {name}.',
    'Next question is already written. It’s about you.',
    'I know where you’re sitting right now.',
    'Too late to change your answer now.',
  ],
};

// The built-in questions: the "AI" can't find anything on these people.
export const GENERIC_LINES = [
  'Searching the internet for {name}… 0 results.',
  '{name} has an impressively small digital footprint.',
  'No data found on {name}. Improvising…',
  'Asking my cousin the toaster about {name}…',
  'Error 404: {name}’s secrets not found.',
  'Googling “{name}”… found a dentist in Ohio.',
  'Hmm, {name} is a mystery. Guessing wildly…',
  'Making something up about {name}. Nobody tell.',
  'My research budget ran out. Generic question incoming.',
  'Couldn’t find {name}’s file. Using a backup question.',
  'Scanning… scanning… {name} is a blank page.',
  'Even my algorithm is confused by {name}.',
  'Upload me some gossip next time, please.',
  '{name} must be a spy. Zero information.',
  'Checking social media… {name} posts nothing. Respect.',
  'The AI is struggling. Please be patient with it 🥲',
];

// While people are still WRITING their answers.
export const WRITE_QUIPS = [
  'Judging everyone’s typing speed…',
  '{slow} is typing a novel.',
  'Somebody is definitely overthinking this.',
  'Sharpening pencils ✏️',
  'Counting keystrokes. Suspiciously many.',
  '{slow} just deleted everything and started over.',
  'The best answers take time. So do the worst ones.',
  'Spell-check is crying somewhere.',
  'Someone is writing something they’ll regret.',
  '{slow} is staring at the ceiling for inspiration.',
  'Plot twist incoming…',
  'Typing… deleting… typing…',
  'Rhyming is optional. Funny is not.',
  '{slow}, the clock is judging you.',
  'Hidden talent detected: dramatic pausing.',
  'Somewhere, an autocorrect is making things worse.',
  'Waiting for the last brilliant idea…',
  'Is {slow} writing an answer or a thesis?',
];

export const WRITE_CREEPY = [
  'The AI already guessed every answer.',
  'Write the truth. It’s easier. I already know it.',
  '{slow}, your hesitation has been noted.',
  'Interesting what people almost type…',
];

// While people are still VOTING.
export const VOTE_QUIPS = [
  'Weighing every answer very seriously…',
  '{slow} is still deciding. Big responsibility.',
  'Someone is trying to guess who wrote what.',
  'Loyalty is being tested right now.',
  'Choosing between funny and true…',
  '{slow} is reading them all again. Slowly.',
  'No voting for yourself. We checked.',
  'Somebody is about to make a friend very happy.',
  'Eeny, meeny, miny… 🤔',
  'Democracy takes time.',
  '{slow} is hovering over two answers.',
  'The judge’s vote counts double — no pressure.',
  'Secret alliances are forming…',
  'Counting votes with my little robot fingers.',
  'Someone just changed their mind three times.',
  'Pick the one that made you snort.',
];

export const VOTE_CREEPY = [
  'The AI knows who wrote each answer. Do you?',
  '{slow}, I saw which one you looked at first.',
  'Vote carefully. I remember everything.',
];

/** Pick n distinct lines, deterministically for a given seed function. */
export function pickLines(pool, n, rand) {
  const a = pool.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}
