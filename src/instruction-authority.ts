// Proposals cannot convert uncertain, conditional or negated words into current authority.
// Each caller separately requires an affirmative phrase for its specific operation.
export function hasCurrentInstructionAuthority(text: string): boolean {
  if (
    /(?:不要|不改|别|还没|尚未|未|没|不|希望|想有空|如果|假如|假设|要是|若|一旦|也许|等到|直到|再|才|就|是否|\b(?:not|never|no|unfinished|incomplete|do not|don['’]t|isn['’]t|hasn['’]t|haven['’]t|wasn['’]t|weren['’]t|didn['’]t|won['’]t|maybe|wish|if|unless|when|once|until|after|should)\b)/i.test(
      text,
    )
  )
    return false;
  return (
    !/(?:吗|[?？]|^(?:is|has|was|did)\b)/i.test(text) ||
    /(?:请|帮我|\b(?:please|can you|could you|would you)\b)/i.test(text)
  );
}
