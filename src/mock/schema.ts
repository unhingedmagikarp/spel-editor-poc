import { t, type TemplateSchema } from '../spel/schema';
import { MOCK_FUNCTIONS } from './functions';

/**
 * MOCK: the data model available to CMS messages.
 * In the real app the BE would serve this (ideally generated from the Java model passed to SpEL).
 */
export const MOCK_SCHEMA: TemplateSchema = {
  rootType: 'Message',
  types: {
    Message: {
      description: 'Everything a message can use.',
      properties: {
        customer: { type: t.object('Customer'), description: 'The person receiving the message.' },
        order: { type: t.object('Order'), description: 'The order this message is about.' },
        store: { type: t.object('Store'), description: 'The shop the order was placed in.' },
      },
    },
    Customer: {
      properties: {
        firstName: { type: t.string, description: 'First name, e.g. Anna.' },
        lastName: { type: t.string, description: 'Last name, e.g. de Vries.' },
        email: { type: t.string },
        tier: {
          type: t.string,
          description: 'Membership level.',
          enumValues: ['STANDARD', 'SILVER', 'GOLD'],
        },
        firstOrder: { type: t.boolean, description: 'true when this is their very first order.' },
        loyalty: {
          type: t.object('Loyalty'),
          nullable: true,
          description: 'Loyalty account. Empty for customers who never joined.',
        },
      },
    },
    Loyalty: {
      properties: {
        points: { type: t.number, description: 'Current points balance.' },
        memberSince: { type: t.date },
      },
    },
    Order: {
      properties: {
        number: { type: t.string, description: 'Order number, e.g. NL-20491.' },
        placedAt: { type: t.date },
        estimatedDelivery: { type: t.date },
        status: { type: t.string, enumValues: ['PLACED', 'SHIPPED', 'DELAYED', 'DELIVERED'] },
        items: { type: t.list(t.object('OrderItem')), description: 'Products in the order.' },
        total: { type: t.number, description: 'Total amount paid.' },
        currency: { type: t.string, description: "Currency code, e.g. 'EUR'." },
        discountCode: { type: t.string, nullable: true, description: 'Code used at checkout, if any.' },
        shippingAddress: { type: t.object('Address') },
      },
    },
    OrderItem: {
      properties: {
        name: { type: t.string },
        quantity: { type: t.number },
        price: { type: t.number, description: 'Price paid per piece.' },
        originalPrice: { type: t.number, description: 'Price before any sale.' },
        onSale: { type: t.boolean },
      },
    },
    Address: {
      properties: {
        street: { type: t.string },
        city: { type: t.string },
        postalCode: { type: t.string },
        country: { type: t.string },
      },
    },
    Store: {
      properties: {
        name: { type: t.string },
        supportEmail: { type: t.string },
        url: { type: t.string },
      },
    },
  },
  functions: MOCK_FUNCTIONS,
  variables: {
    locale: { type: t.string, description: "The message language, e.g. 'en-GB'." },
  },
};
