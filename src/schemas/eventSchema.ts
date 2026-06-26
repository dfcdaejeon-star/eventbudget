const eventSchema = {
  $id: 'EventData',
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    organizer: { type: 'string' },
    financeManager: { type: 'string' },
    period: { type: 'string' },
    notes: { type: 'string' },
    incomes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          category: { type: 'string' },
          description: { type: 'string' },
          amount: { type: 'number' },
          note: { type: 'string' }
        },
        required: ['id', 'amount']
      }
    },
    expenses: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          date: { type: 'string' },
          department: { type: 'string' },
          purpose: { type: 'string' },
          item: { type: 'string' },
          amount: { type: 'number' },
          receiptName: { type: 'string' },
          note: { type: 'string' },
          receiptNumber: { type: 'string' }
        },
        required: ['id', 'amount']
      }
    }
  },
  required: ['id', 'name', 'incomes', 'expenses']
};

export default eventSchema;
