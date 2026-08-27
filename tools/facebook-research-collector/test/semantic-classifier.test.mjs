import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyPostSemantically } from '../src/semantic-classifier.mjs';

function mockResponse(result) {
  return async (_url, options) => {
    const request = JSON.parse(options.body);
    assert.equal(request.text.format.type, 'json_schema');
    assert.equal(request.text.format.strict, true);
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      async json() {
        return {
          output: [{
            type: 'message',
            content: [{ type: 'output_text', text: JSON.stringify(result) }],
          }],
        };
      },
    };
  };
}

test('semantic classifier keeps a post whose main subject is personal expense management', async () => {
  const previous = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'test-key';
  try {
    const result = await classifyPostSemantically({
      body: 'Mình làm ứng dụng quản lý chi tiêu cá nhân, tự động lấy giao dịch ngân hàng và vẫn cho nhập tiền mặt.',
      query: 'quản lý chi tiêu',
      config: {},
      fetchImpl: mockResponse({ relevant: true, confidence: 0.98, reason: 'Main subject is personal expense tracking.' }),
    });
    assert.equal(result.relevant, true);
    assert.equal(result.confidence, 0.98);
    assert.equal(result.model, 'gpt-5.6-luna');
  } finally {
    if (previous == null) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previous;
  }
});

test('semantic classifier rejects unrelated content even when it mentions apps or money incidentally', async () => {
  const previous = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'test-key';
  try {
    const result = await classifyPostSemantically({
      body: 'Ra mắt nền tảng cloud gaming mới. App có gói thanh toán theo tháng và nhiều game chiến thuật.',
      query: 'quản lý chi tiêu',
      config: {},
      fetchImpl: mockResponse({ relevant: false, confidence: 0.99, reason: 'Main subject is cloud gaming, not personal finance.' }),
    });
    assert.equal(result.relevant, false);
  } finally {
    if (previous == null) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previous;
  }
});

test('semantic classifier refuses keyword fallback when API key is missing', async () => {
  const previous = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    await assert.rejects(
      () => classifyPostSemantically({
        body: 'Bài viết quản lý chi tiêu cá nhân.',
        query: 'quản lý chi tiêu',
        config: {},
        fetchImpl: async () => { throw new Error('must not call'); },
      }),
      /Refusing to fall back to keyword scoring/,
    );
  } finally {
    if (previous != null) process.env.OPENAI_API_KEY = previous;
  }
});

test('empty post body is rejected without spending a model call', async () => {
  let called = false;
  const result = await classifyPostSemantically({
    body: '   ',
    query: 'quản lý chi tiêu',
    config: {},
    fetchImpl: async () => { called = true; throw new Error('unexpected'); },
  });
  assert.equal(result.relevant, false);
  assert.equal(result.reason, 'empty-post-body');
  assert.equal(called, false);
});
