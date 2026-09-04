# Timing Optimization Counterexamples

Load only the section that matches the current hypothesis. These are generic
failure modes. Every project must re-establish its own cycle and timing evidence.

## A final selector register overloads its D cone

Registering one final arbitration result can move eligibility, age partition,
and priority encoding onto one D input. Registering smaller intermediate results
from one next-state version may balance D and Q paths. Measure both boundaries.

## Narrow-before-select moves work upstream

Selecting narrow candidate views reduces consumer mux width and routing. The
extraction and selection move into a producer D cone when the view is
registered. A shorter Q path does not establish whole-design improvement.

## Distributed work duplicates logic

Moving comparison or arithmetic into every candidate lane can overlap a late
selector and remove a serial stage. It also adds operators, shared-input fanout,
and routes. The transformation is useful only when the measured limiting source
actually participates in selector generation.

## Late override reassociation misses a consumer

One final qualified override shortens a nested mux only when the class predicate
identifies every legal consumer. A separate consumer may require the fully
overridden view. Trace all consumers and use an equivalence assertion.

## A cached predicate becomes stale permission

A local registered predicate can remove a global compare from arbitration. If
ownership, identity, or source state changes before use, stale true can authorize
the wrong transaction. Define initialization and invalidation for allocation,
flush, release, and reuse.

## Admission simplification leaks into state

Removing a late valid term from `ready` is safe only when every write and
allocation remains acceptance-gated. One hidden pointer, counter, or side-effect
update is enough to make an invalid lane mutate state.

## Compact equality aliases across a boundary

Dropped bits remain identity outside the proven domain. Region crossing, wrap,
alignment, and sign extension can make two compact values equal while full
values differ. An explicit guard and boundary tests are mandatory.

## Side-effect-free reads are not always free

Removing late validity from synchronous RAM enable can shorten a control path.
It can also change output-hold behavior, read-during-write behavior, switching
power, or a downstream ownership event. Audit every consumer and write port.

## A registered wide view recreates the path

Registering a queue or table view removes Q-side selection and creates a
next-state maintenance cone at D. Enqueue data, bank mapping, head selection,
flush, and hold logic can make the new D path the bottleneck.

## Pipelined global control permits one bad cycle

Adding a cycle to recovery or suppression is legal only when affected work
cannot create an irreversible effect during that cycle. A compensating immediate
block may recreate the same global path.

## Registered replicas collapse physically

Source-level aliases do not create physical copies, and equivalent registers can
merge. A replication change has no established timing effect until netlist
connectivity shows distinct Q drivers serving disjoint regions.

## A redundant-looking guard carries protocol meaning

An outer zero mux around one-hot selection may also encode kill, hold, flush, or
transaction validity. Remove it only when zero-hot behavior is correct and every
other protocol meaning is carried separately.

## A top-N report hides the affected family

Absence from a small global report does not prove a family is clean or removed.
Use a directed query for local claims and an endpoint-worst population for global
coverage claims.
