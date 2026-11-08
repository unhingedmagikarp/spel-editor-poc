/** MOCK: example messages to demo the editor with. */

export interface TemplatePreset {
  readonly id: string;
  readonly label: string;
  readonly field: string;
  readonly body: string;
}

export const TEMPLATE_PRESETS: readonly TemplatePreset[] = [
  {
    id: 'confirmation',
    label: 'Order confirmation',
    field: 'Email · Order confirmation · Intro',
    body: `Hi #{customer.firstName},

Thanks for your order #{order.number}! #{order.items.size() > 1 ? 'Your ' + order.items.size() + ' items are' : 'Your item is'} on the way and should arrive on #{#formatDate(order.estimatedDelivery, 'EEEE d MMMM')}.

#{customer.tier == 'GOLD' ? 'As a Gold member, shipping is on us.' : 'Become a Gold member to get free shipping.'}

Order total: #{#formatPrice(order.total, order.currency)}`,
  },
  {
    id: 'loyalty',
    label: 'Loyalty points (fails for one sample)',
    field: 'Email · Order confirmation · Loyalty block',
    body: `Hi #{customer.firstName}, you now have #{customer.loyalty.points} points — #{customer.loyalty.points >= 1000 ? 'enough for a free gift!' : (1000 - customer.loyalty.points) + ' to go until your next reward.'}`,
  },
  {
    id: 'savings',
    label: 'Sale savings (long expression)',
    field: 'Email · Order confirmation · Savings banner',
    body: `#{order.items.?[onSale].size() > 0 ? 'Good news, ' + customer.firstName + ': ' + #pluralize(order.items.?[onSale].size(), 'item', 'items') + ' in your order ' + (order.items.?[onSale].size() > 1 ? 'were' : 'was') + ' on sale, so you saved ' + #formatPrice(#sum(order.items.?[onSale].![(originalPrice - price) * quantity]), order.currency) + '.' + (order.discountCode != null ? ' Your code ' + order.discountCode + ' was applied too.' : '') : 'Thanks for shopping with ' + store.name + '.'}`,
  },
  {
    id: 'mistakes',
    label: 'Common mistakes',
    field: 'Email · Shipping update · Body',
    body: `Dear #{customer.fristName},

#{customer.tier == 'Gold' ? 'Thanks for being a Gold member!' : ''}
#{customer.loyalty ? 'You have points.' : 'Join our loyalty programme.'}
Your order total is #{#formatPrice(order.total}.
#{order.items.?[price > order.total / 2].size()} of your items made up most of the total.
We'll deliver to #{order.shippingAddress.city} on #{order.estimatedDelivery}.
Track it here: #{#trackingUrl(order.number)}`,
  },
  {
    id: 'blank',
    label: 'Blank',
    field: 'Email · New message',
    body: '',
  },
];
