import { books, findBook, verseCountForChapter } from './bibleData.js?v=4';

const bookPattern = books
  .flatMap((book) => [book.name, ...book.aliases])
  .sort((a, b) => b.length - a.length)
  .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+'))
  .join('|');

const passageRegex = new RegExp(`\\b(${bookPattern})\\.?\\s*(\\d{1,3})(?::(\\d{1,3}))?(?:\\s*-\\s*(?:(\\d{1,3}):)?(\\d{1,3}))?`, 'gi');

const normalizeText = (value) => String(value || '').toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ').trim();

function countRange(book, startChapter, startVerse, endChapter, endVerse) {
  if (!book) return null;
  if (startChapter < 1 || startChapter > book.chapters.length) return null;
  if (endChapter < startChapter || endChapter > book.chapters.length) return null;

  let total = 0;

  for (let chapter = startChapter; chapter <= endChapter; chapter += 1) {
    const chapterVerses = verseCountForChapter(book.name, chapter);
    if (!chapterVerses) return null;

    const first = chapter === startChapter ? startVerse : 1;
    const last = chapter === endChapter ? endVerse : chapterVerses;

    if (first < 1 || last > chapterVerses || first > last) return null;
    total += last - first + 1;
  }

  return total;
}

function parseMatch(match) {
  const [, rawBook, rawChapter, rawStartVerse, rawEndChapter, rawEndVerse] = match;
  const book = findBook(rawBook);
  if (!book) return null;

  const startChapter = Number(rawChapter);
  const hasExplicitStartVerse = Boolean(rawStartVerse);
  const startVerse = hasExplicitStartVerse ? Number(rawStartVerse) : 1;
  const endChapter = rawEndChapter ? Number(rawEndChapter) : startChapter;
  const endVerse = rawEndVerse
    ? Number(rawEndVerse)
    : hasExplicitStartVerse
      ? startVerse
      : verseCountForChapter(book.name, startChapter);

  const verseCount = countRange(book, startChapter, startVerse, endChapter, endVerse);
  if (verseCount === null) return null;

  const label =
    startChapter === endChapter && startVerse === 1 && endVerse === verseCountForChapter(book.name, startChapter)
      ? `${book.name} ${startChapter}`
      : startChapter === endChapter && startVerse === endVerse
        ? `${book.name} ${startChapter}:${startVerse}`
        : startChapter === endChapter
          ? `${book.name} ${startChapter}:${startVerse}-${endVerse}`
          : `${book.name} ${startChapter}:${startVerse}-${endChapter}:${endVerse}`;

  return {
    book: book.name,
    startChapter,
    startVerse,
    endChapter,
    endVerse,
    verseCount,
    label,
  };
}

export function parsePassage(input) {
  const text = input.trim();
  if (!text) {
    return {
      ranges: [],
      verseCount: 0,
      normalized: '',
      status: 'empty',
      message: '',
    };
  }

  const matches = [...text.matchAll(passageRegex)];
  const ranges = matches.map(parseMatch).filter(Boolean);

  if (ranges.length === 0) {
    return {
      ranges: [],
      verseCount: null,
      normalized: text,
      status: 'unknown',
      message: 'Verse count could not be calculated yet.',
    };
  }

  return {
    ranges,
    verseCount: ranges.reduce((sum, range) => sum + range.verseCount, 0),
    normalized: ranges.map((range) => range.label).join('; '),
    status: 'parsed',
    message: '',
  };
}

export function bibleGatewayUrl(range) {
  if (!range) return null;
  const passage = `${range.book} ${range.startChapter}:${range.startVerse}-${range.endChapter}:${range.endVerse}`;
  return `https://www.biblegateway.com/passage/?search=${encodeURIComponent(passage)}&version=WEB`;
}

export function getPassageSuggestions(input) {
  const text = input.trim();
  const numberMatch = text.match(/\d/);
  if (!text || !numberMatch) return [];

  const bookText = normalizeText(text.slice(0, numberMatch.index));
  const referenceText = text.slice(numberMatch.index).trim();
  if (!bookText || !referenceText) return [];

  return books
    .map((book) => {
      const names = [book.name, ...book.aliases].map(normalizeText);
      const score = names.reduce((best, name) => {
        if (name === bookText) return Math.max(best, 100);
        if (name.startsWith(bookText)) return Math.max(best, 80 - Math.abs(name.length - bookText.length));
        if (bookText.startsWith(name)) return Math.max(best, 70 - Math.abs(name.length - bookText.length));
        if (name.includes(bookText) || bookText.includes(name)) return Math.max(best, 45);
        return best;
      }, 0);
      const passage = `${book.name} ${referenceText}`;
      return { book, score, passage, parsed: parsePassage(passage) };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.book.name.localeCompare(b.book.name))
    .slice(0, 4)
    .map((item) => ({
      label: item.parsed.status === 'parsed' ? item.parsed.normalized : item.passage,
      value: item.passage,
    }));
}
