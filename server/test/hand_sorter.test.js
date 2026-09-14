const assert = require('assert');

// In client ts code, handSorter is written in TS. For node mocha tests, we can test the sorting rules directly.
describe('Hand Sorter Logic', () => {
  const cards = [
    { id: '1', title: 'Pass Go', kind: 'ACTION', value: 1 },
    { id: '2', title: 'Boardwalk', kind: 'PROPERTY', color: 'DarkBlue', value: 4 },
    { id: '3', title: '$5M Money', kind: 'MONEY', value: 5 },
    { id: '4', title: 'Dark Blue Wildcard', kind: 'WILDCARD', colors: ['DarkBlue', 'Green'], value: 4 },
    { id: '5', title: 'DarkBlue Rent', kind: 'RENT', value: 1 },
    { id: '6', title: 'Baltic Avenue', kind: 'PROPERTY', color: 'Brown', value: 1 }
  ];

  function getCardKind(card) {
    const k = card.kind || card.type || '';
    if (k === 'WILDCARD') return 'WILDCARD';
    if (k === 'PROPERTY') return 'PROPERTY';
    if (k === 'ACTION') return 'ACTION';
    if (k === 'RENT') return 'RENT';
    if (k === 'MONEY') return 'MONEY';
    if (card.colors && card.colors.length > 0) return 'WILDCARD';
    if (card.color) return 'PROPERTY';
    return 'ACTION';
  }

  const KIND_PRIORITY = {
    WILDCARD: 1,
    PROPERTY: 2,
    ACTION: 3,
    RENT: 4,
    MONEY: 5
  };

  const COLOR_ORDER = [
    'Brown', 'DarkBlue', 'Green', 'LightBlue', 'Orange', 'Purple', 'Railroad', 'Red', 'Utility', 'Yellow', 'ALL'
  ];

  function calculateTotalHandValue(cardList) {
    return cardList.reduce((sum, c) => sum + (c.value || 0), 0);
  }

  function sortCards(cardList, mode) {
    if (mode === 'DEFAULT') return [...cardList];
    const sorted = [...cardList];

    if (mode === 'TYPE') {
      sorted.sort((a, b) => {
        const kindA = getCardKind(a);
        const kindB = getCardKind(b);
        const prioA = KIND_PRIORITY[kindA] || 99;
        const prioB = KIND_PRIORITY[kindB] || 99;
        if (prioA !== prioB) return prioA - prioB;
        return (b.value || 0) - (a.value || 0);
      });
    } else if (mode === 'VALUE') {
      sorted.sort((a, b) => {
        const valA = a.value || 0;
        const valB = b.value || 0;
        if (valA !== valB) return valB - valA;
        return (a.title || '').localeCompare(b.title || '');
      });
    } else if (mode === 'COLOR') {
      sorted.sort((a, b) => {
        const colA = a.color || (a.colors && a.colors[0]) || 'Z_OTHER';
        const colB = b.color || (b.colors && b.colors[0]) || 'Z_OTHER';
        const idxA = COLOR_ORDER.indexOf(colA);
        const idxB = COLOR_ORDER.indexOf(colB);
        const rankA = idxA >= 0 ? idxA : 99;
        const rankB = idxB >= 0 ? idxB : 99;
        if (rankA !== rankB) return rankA - rankB;
        return (b.value || 0) - (a.value || 0);
      });
    }
    return sorted;
  }

  it('calculates total hand value correctly', () => {
    const total = calculateTotalHandValue(cards);
    assert.strictEqual(total, 16); // 1 + 4 + 5 + 4 + 1 + 1 = 16
  });

  it('sorts cards by TYPE correctly (Wildcard -> Property -> Action -> Rent -> Money)', () => {
    const sorted = sortCards(cards, 'TYPE');
    const kinds = sorted.map(c => getCardKind(c));
    assert.deepStrictEqual(kinds, ['WILDCARD', 'PROPERTY', 'PROPERTY', 'ACTION', 'RENT', 'MONEY']);
  });

  it('sorts cards by VALUE correctly (descending value)', () => {
    const sorted = sortCards(cards, 'VALUE');
    const values = sorted.map(c => c.value);
    assert.deepStrictEqual(values, [5, 4, 4, 1, 1, 1]);
    // The top card should be $5M Money
    assert.strictEqual(sorted[0].id, '3');
  });

  it('sorts cards by COLOR correctly (Brown -> DarkBlue)', () => {
    const sorted = sortCards(cards, 'COLOR');
    const colors = sorted.map(c => c.color || (c.colors && c.colors[0]));
    // Baltic Avenue (Brown) comes before Boardwalk & Dark Blue Wildcard
    assert.strictEqual(colors[0], 'Brown');
    assert.strictEqual(colors[1], 'DarkBlue');
  });

  it('preserves DEFAULT sequence when mode is DEFAULT', () => {
    const sorted = sortCards(cards, 'DEFAULT');
    assert.deepStrictEqual(sorted.map(c => c.id), ['1', '2', '3', '4', '5', '6']);
  });
});
