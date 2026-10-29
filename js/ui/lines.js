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

// A deck is loaded, but this question is about someone the deck doesn't mention.
export const IMPROV_LINES = [
  "Opening {name}'s file… it's empty. Suspicious.",
  'The host told me nothing about {name}. Improvising…',
  "{name} isn't in my notes. Making a note now.",
  'Nobody briefed me on {name}. Guessing… boldly.',
  "No file on {name}. That's either very innocent or very clever.",
  '{name} slipped past my research. Not for long.',
  'Asking the others about {name} instead…',
  'Unknown subject: {name}. Starting a new file 📁',
];

// A deck is loaded but it ran out of questions for this group: the AI freestyles.
export const OUT_OF_FILE_LINES = [
  "I've used up everything the host told me…",
  'Out of gossip. Switching to plan B.',
  'The secret file is empty now. Freestyling…',
  'Running low on material. Improvising about {name}…',
  'Ok, no more notes. Time to wing it.',
];

// Questions built from what the AI noticed on the devices / during the game.
export const CLUE_LINES = {
  any: ['I noticed something.', 'Nobody told me this. I just… noticed.', 'Collecting clues…', 'Writing down what I saw…'],
  nodeck: ['Nobody uploaded anything about you all. So I watched instead.', "No file needed. I've been paying attention."],
  place: ['Pinging everyone’s location… roughly.', 'Triangulating {name}…', 'Checking the time zones…', 'Measuring the distance between you…'],
  device: ["Inspecting {name}'s device from across the room…", 'Counting phones… and what kind.', "Reading {name}'s battery level…", 'Looking at the screen. Not the game. The screen.'],
  lang: ["Checking {name}'s keyboard settings…", 'Listening for accents…', 'Translating…'],
  net: ['Tracing everyone’s Wi-Fi…', 'Following the signal…', 'Who is sharing a connection? Hmm.'],
  time: ['Checking everyone’s clocks…', 'Looking at the time where {name} is…', 'Doing time-zone math…'],
  habit: ["Replaying {name}'s keystrokes…", 'Reviewing how {name} plays…', 'I counted. Of course I counted.', 'Checking who left the game, and when…'],
  group: ['Reviewing tonight’s game so far…', 'Looking at the scoreboard. And at you.', 'Updating my files with tonight’s data…'],
};

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
