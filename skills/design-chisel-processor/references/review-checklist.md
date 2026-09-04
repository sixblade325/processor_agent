# Cycle-Accurate Review Checklist

## State

- Does every field have one precise meaning?
- Are set and clear conditions complete?
- Is validity independent from stale payload bits?
- Are all writers covered by one priority order?

## Cycles

- Which values are visible at cycle start?
- Which events are combinational in the current cycle?
- Which updates appear after the edge?
- Do RAM read-during-write semantics match the proof?

## Queues and indices

- Who allocates the slot?
- Which structures retain the index?
- Can completion occur before every reference disappears?
- Can release and allocation target the same slot in one cycle?
- Can a late response hit a reused slot?
- Does a mask bit still identify the original entry after reuse?
- Is extra identity metadata proven necessary by a lifetime counterexample?

## Events

- Is the event one-shot or persistent?
- Can a new consumer appear in the same cycle?
- Does registration require bypass?
- Can an event be lost while a request waits in another queue?
- Would persistent state or polling remove fragile wakeup wiring?

## Flush and kill

- Which module produces flush?
- When does each consumer see it?
- Are combinational side effects blocked before registers clear?
- Which committed operations survive?
- If committed and speculative entries share storage, are their next-state rules separated?
- Which external transactions cannot stop?
- Does a killed request regain eligibility before younger requests proceed?

## Speculation

- What state becomes speculative?
- What exact cycle first allows a consumer to act?
- Can failure inhibit that action in the same cycle?
- Does flush remove producer, consumers, and speculative-ready state together?

## Memory ordering

- How is older/younger determined?
- Is selection global, local, banked, or FIFO ordered?
- Which address granularity requires ordering?
- When does a Store become visible?
- When may a Load clear a Store dependency?

## MSHR and buffers

- Is primary ownership unique per block?
- Can secondary entries outlive queue entries?
- Are release and secondary invalidation atomic?
- Can an active transaction continue with no secondary?
- Can such a transaction accidentally release an LSQ entry?
- Are RB/VB ownership and bus transaction IDs separate from LSQ identity?

## Timing

- Count compare lanes by queue length and issue width.
- Count wide muxes and priority encoders.
- Identify high-fanout masks and long buses.
- Separate unavoidable logic from optional state maintenance.
- Do not assume synthesis preserves hand-written grouping.

## Alternative comparison

- Are both alternatives complete and correct before cost comparison?
- Are capacity, width, lanes, and stage boundaries equal?
- Are required clears, bypasses, retries, and release rules included?
- Is each defect inherent, or caused by an omitted mechanism?
- Are persistent maintenance and repeated recomputation counted separately?
- Does a recommendation preserve the selected architecture unless an invariant fails?

## Verification

Require cycle-specific tests for:

- same-cycle allocate and wake;
- release and attempted reuse;
- response and flush;
- release and flush;
- miss ownership and flush;
- late external response;
- full queue or full MSHR;
- multiple lanes targeting the same structure;
- mask clear and slot reuse;
- Store/Load visibility around RAM writes.
