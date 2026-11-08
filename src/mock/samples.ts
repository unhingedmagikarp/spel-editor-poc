import type { SpelRecord, SpelValue } from '../spel/types';

/** MOCK: sample data sets editors can preview a message against. */

export interface Sample {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly data: SpelRecord;
  readonly variables: Readonly<Record<string, SpelValue>>;
}

const day = (year: number, month: number, date: number): Date => new Date(Date.UTC(year, month - 1, date));

const store: SpelRecord = { name: 'Northwind Outfitters', supportEmail: 'help@northwind.example', url: 'https://northwind.example' };

const anna: SpelRecord = {
  customer: {
    firstName: 'Anna',
    lastName: 'de Vries',
    email: 'anna@example.com',
    tier: 'GOLD',
    firstOrder: false,
    loyalty: { points: 2450, memberSince: day(2019, 3, 14) },
  },
  order: {
    number: 'NL-20491',
    placedAt: day(2026, 11, 6),
    estimatedDelivery: day(2026, 11, 10),
    status: 'SHIPPED',
    currency: 'EUR',
    total: 154.8,
    discountCode: 'AUTUMN15',
    items: [
      { name: 'Merino wool scarf', quantity: 1, price: 39.95, originalPrice: 49.95, onSale: true },
      { name: 'Leather gloves', quantity: 2, price: 44.95, originalPrice: 44.95, onSale: false },
      { name: 'Wool socks (3-pack)', quantity: 1, price: 24.95, originalPrice: 29.95, onSale: true },
    ],
    shippingAddress: { street: 'Prinsengracht 263', city: 'Amsterdam', postalCode: '1016 GV', country: 'NL' },
  },
  store,
};

const ben: SpelRecord = {
  customer: {
    firstName: 'Ben',
    lastName: 'Okafor',
    email: 'ben@example.com',
    tier: 'STANDARD',
    firstOrder: true,
    loyalty: null,
  },
  order: {
    number: 'NL-20502',
    placedAt: day(2026, 11, 7),
    estimatedDelivery: day(2026, 11, 12),
    status: 'PLACED',
    currency: 'EUR',
    total: 19.95,
    discountCode: null,
    items: [{ name: 'Canvas tote bag', quantity: 1, price: 19.95, originalPrice: 19.95, onSale: false }],
    shippingAddress: { street: 'Rue Oberkampf 12', city: 'Paris', postalCode: '75011', country: 'FR' },
  },
  store,
};

const chloe: SpelRecord = {
  customer: {
    firstName: 'Chloé',
    lastName: 'Martin',
    email: 'chloe@example.com',
    tier: 'SILVER',
    firstOrder: false,
    loyalty: { points: 380, memberSince: day(2024, 9, 2) },
  },
  order: {
    number: 'NL-20377',
    placedAt: day(2026, 10, 29),
    estimatedDelivery: day(2026, 11, 14),
    status: 'DELAYED',
    currency: 'GBP',
    total: 112,
    discountCode: null,
    items: [
      { name: 'Rain jacket', quantity: 1, price: 89, originalPrice: 119, onSale: true },
      { name: 'Beanie', quantity: 1, price: 23, originalPrice: 28, onSale: true },
    ],
    shippingAddress: { street: '221 Camden High St', city: 'London', postalCode: 'NW1 7BU', country: 'GB' },
  },
  store,
};

export const SAMPLES: readonly Sample[] = [
  { id: 'anna', label: 'Anna', description: 'Gold member · 3 items · discount code', data: anna, variables: { locale: 'en-GB' } },
  { id: 'ben', label: 'Ben', description: 'First order · no loyalty account', data: ben, variables: { locale: 'en-GB' } },
  { id: 'chloe', label: 'Chloé', description: 'Silver · delayed · everything on sale', data: chloe, variables: { locale: 'en-GB' } },
];
