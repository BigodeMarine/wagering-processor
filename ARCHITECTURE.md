# Arquitetura

## 1. Visão geral

Este projeto implementa um processador distribuído de operações de
apostas, projetado para executar operações financeiras com segurança por
HTTP e mensageria assíncrona.

Os principais objetivos arquiteturais são:

-   garantir correção financeira;
-   garantir idempotência persistente;
-   processar operações concorrentes com segurança entre múltiplas
    instâncias;
-   manter todas as alterações de saldo auditáveis;
-   publicar eventos de integração somente após a confirmação do estado
    financeiro;
-   permitir recuperação segura após falhas parciais de infraestrutura.

A aplicação utiliza Bun 1.x, NestJS, TypeScript em modo `strict`,
PostgreSQL, MikroORM, AWS SQS através de LocalStack e Docker Compose.

O PostgreSQL é a fonte final de verdade para as invariantes financeiras.
Ordenação do broker, filas FIFO e memória do processo não são
consideradas garantias suficientes de consistência financeira.

------------------------------------------------------------------------

## 2. Princípios e invariantes

As principais invariantes do sistema são:

-   o saldo de uma carteira nunca pode ficar negativo;
-   a mesma operação financeira não pode produzir créditos ou débitos
    duplicados;
-   toda alteração real de saldo possui exatamente um lançamento
    correspondente no ledger;
-   lançamentos do ledger são imutáveis;
-   transações rejeitadas não alteram o saldo e não geram lançamentos no
    ledger;
-   idempotência deve sobreviver a reinicializações e funcionar entre
    múltiplas instâncias;
-   eventos associados a alterações financeiras nunca são publicados
    antes do commit da transação financeira;
-   invariantes que podem ser expressas no banco também são protegidas
    por constraints;
-   não existe lock global da aplicação;
-   a correção financeira não depende exclusivamente da deduplicação do
    SQS FIFO.

------------------------------------------------------------------------

## 3. Arquitetura em camadas

O domínio é independente de NestJS, MikroORM e mecanismos de transporte.

Objetos de domínio não dependem diretamente de:

-   HTTP;
-   SQS;
-   decorators do NestJS;
-   entidades do MikroORM;
-   tipos monetários específicos do PostgreSQL.

As representações de persistência e transporte são convertidas nas
fronteiras da infraestrutura através de mappers explícitos.

A camada de aplicação contém os casos de uso e contratos de repository.
A infraestrutura fornece as implementações de persistência, mensageria,
geração de identificadores e relógio.

Conceitualmente:

``` text
HTTP / SQS
    ↓
Application Use Cases
    ↓
Domain
    ↓
Repository Ports
    ↓
MikroORM / PostgreSQL
```

Essa separação permite testar as regras financeiras de forma
determinística sem depender do framework ou de infraestrutura externa.

------------------------------------------------------------------------

## 4. Modelo monetário

### 4.1 Money

Valores monetários são representados pelo Value Object `Money`.

`number`, `float` e `double` nunca são utilizados para representar
dinheiro.

A representação externa é:

``` ts
interface MoneyProps {
  amount: string;
  currency: string;
}
```

Internamente, operações aritméticas utilizam Decimal.js.

`Money` é imutável: operações como soma, subtração e negação retornam
novas instâncias.

O Value Object valida:

-   representação decimal;
-   no máximo duas casas decimais na entrada;
-   valores finitos;
-   valores monetários externos não negativos;
-   moeda representada por três letras maiúsculas;
-   compatibilidade de moeda nas operações aritméticas.

A serialização sempre produz duas casas decimais:

``` text
"25"   → "25.00"
"25.5" → "25.50"
```

### 4.2 Persistência monetária

Valores monetários são persistidos como `NUMERIC(19,2)` no PostgreSQL.

A fronteira é:

``` text
HTTP / SQS
string decimal
      ↓
Money
Decimal.js
      ↓
Persistence Mapper
string decimal
      ↓
PostgreSQL
NUMERIC(19,2)
```

Na camada de persistência os valores continuam representados como
`string`, evitando conversão para `number` do JavaScript.

------------------------------------------------------------------------

## 5. Modelo financeiro

### 5.1 Wallet

`Wallet` é o Aggregate Root responsável por proteger as invariantes do
saldo.

Uma carteira pertence a um jogador e possui uma moeda específica.

O domínio garante que:

-   a moeda da operação deve coincidir com a moeda da carteira;
-   um débito não pode resultar em saldo negativo;
-   alterações de saldo passam pelos métodos do domínio;
-   `version` inicia em `1`;
-   `version` é incrementada somente quando o saldo realmente muda;
-   movimentações de valor zero não alteram saldo nem versão.

Uma alteração real de saldo produz um `WalletMovement` contendo direção,
valor, saldo anterior e saldo posterior. Esse movimento é utilizado para
construir o lançamento correspondente no ledger.

O banco garante unicidade de:

``` text
playerId + currency
```

Identificadores internos são UUIDs no PostgreSQL e `string` na
aplicação.

### 5.2 WalletLedgerEntry

`WalletLedgerEntry` representa um lançamento financeiro imutável.

Cada lançamento contém:

-   carteira;
-   transação;
-   direção;
-   valor;
-   saldo anterior;
-   saldo posterior;
-   data de criação.

A factory valida:

``` text
DEBIT:
balanceBefore - amount = balanceAfter

CREDIT:
balanceBefore + amount = balanceAfter
```

O banco impede mais de um lançamento para a mesma combinação:

``` sql
UNIQUE (wallet_id, transaction_id)
```

Transações `LOSS` e transações `REJECTED` não geram lançamentos.

### 5.3 WagerTransaction

`WagerTransaction` representa o ciclo de vida de uma operação de aposta.

Tipos suportados:

-   `OPENING`;
-   `BET`;
-   `WIN`;
-   `LOSS`;
-   `REFUND`;
-   `ROLLBACK`.

`OPENING` é uma transação interna e não faz parte do contrato externo de
wagering.

Estados:

-   `PENDING`;
-   `PENDING_REFERENCE`;
-   `PROCESSED`;
-   `REJECTED`;
-   `FAILED`.

Toda transação nasce como `PENDING`.

`PROCESSED`, `REJECTED` e `FAILED` são estados terminais.

`REFUND` e `ROLLBACK` exigem `referenceExternalTransactionId`.

### 5.4 Resultado persistido para replay

Uma `WagerTransaction` persiste `resultingBalance` quando existe um
resultado financeiro determinístico.

Esse valor representa o saldo observado quando a operação atingiu seu
resultado e não é reconstruído usando o saldo atual da carteira durante
um replay.

Exemplo:

``` text
BET:
100.00 → 75.00

WIN posterior:
75.00 → 125.00

Replay da BET:
retorna 75.00, não 125.00
```

Isso mantém o replay idempotente determinístico.

`resultingBalance` utiliza `NUMERIC(19,2)` no PostgreSQL e `string` na
aplicação.

------------------------------------------------------------------------

## 6. Referências, REFUND e ROLLBACK

Sistemas distribuídos não podem assumir que a transação referenciada
sempre chegará antes da operação dependente.

Quando um `REFUND` ou `ROLLBACK` válido referencia uma transação ainda
não localizada, a operação pode permanecer em:

``` text
PENDING_REFERENCE
```

A referência externa é resolvida pela combinação:

``` text
(providerId, referenceExternalTransactionId)
```

Após localizar a transação original, o domínio valida:

-   a referência está em `PROCESSED`;
-   provider é o mesmo;
-   player é o mesmo;
-   wallet é a mesma;
-   currency é a mesma;
-   round é o mesmo;
-   valor é exatamente igual;
-   `REFUND` referencia somente `BET`;
-   `ROLLBACK` referencia `BET`, `WIN` ou `REFUND`.

O modelo mantém duas referências:

-   `reference_external_transaction_id`: identificador recebido do
    provider;
-   `reference_transaction_id`: UUID interno da transação resolvida.

A segunda é nullable e possui foreign key autorreferente para
`wager_transaction.id`.

### 6.1 Prevenção de reversões duplicadas

Uma transação não pode ser revertida duas vezes pelo mesmo tipo de
reversão.

Exemplo:

``` text
BET-001
├── REFUND-001  → permitido
└── REFUND-002  → rejeitado

WIN-001
├── ROLLBACK-001 → permitido
└── ROLLBACK-002 → rejeitado
```

Regras que dependem do histórico persistido são verificadas pela camada
de aplicação/repository e reforçadas pelo banco quando possível.

------------------------------------------------------------------------

## 7. Failure codes

Rejeições de negócio utilizam códigos estáveis e legíveis por máquina:

``` text
INSUFFICIENT_BALANCE
REVERSAL_WOULD_CAUSE_NEGATIVE_BALANCE
REFERENCE_NOT_FOUND
REFERENCE_MISMATCH
INVALID_REFERENCE_KIND
REVERSAL_AMOUNT_MISMATCH
REFERENCE_ALREADY_REVERSED
PERMANENT_INFRASTRUCTURE_FAILURE
```

Incompatibilidades de provider, player, wallet, currency ou round são
agrupadas como `REFERENCE_MISMATCH`.

Reutilizar uma `idempotencyKey` com payload diferente não altera a
transação original e é tratado como conflito de idempotência pela camada
de aplicação/API, não como um novo `failureCode` da transação.

------------------------------------------------------------------------

## 8. Persistência e constraints

Entidades do MikroORM permanecem separadas dos objetos de domínio.

A conversão utiliza mappers explícitos:

``` text
WalletEntity
    ↓ WalletMapper.toDomain()
Wallet

Wallet
    ↓ WalletMapper.toPersistence()
WalletEntity
```

Enums de domínio são armazenados como `VARCHAR` e protegidos por
`CHECK constraints` nas migrations.

Timestamps persistidos utilizam `TIMESTAMPTZ`.

Os repositories utilizam o `EntityManager` pertencente ao contexto
transacional. Não realizam `flush()` independente que possa quebrar a
atomicidade da unidade de trabalho.

As migrations também protegem invariantes críticas, incluindo:

-   saldo da wallet não negativo;
-   unicidade de `player + currency`;
-   unicidade de `idempotency_key`;
-   unicidade de lançamentos do ledger;
-   foreign keys;
-   valores permitidos para enums;
-   regras persistentes relacionadas a reversões quando expressáveis no
    schema.

Migrations manuais que contêm essas constraints são tratadas como parte
da especificação do sistema e não devem ser substituídas automaticamente
por schema diffs que removam garantias deliberadamente adicionadas.

------------------------------------------------------------------------

## 9. Limite transacional e atomicidade

O limite transacional é controlado pela camada de aplicação através do
`EntityManager.transactional()` do MikroORM.

Todos os repositories de uma operação utilizam o mesmo `EntityManager`
transacional.

Quando aplicável, uma única transação PostgreSQL contém:

``` text
InboxMessage
+
WagerTransaction
+
Wallet
+
WalletLedgerEntry
+
OutboxMessage
```

O commit ocorre somente quando toda a unidade de trabalho termina com
sucesso. Qualquer falha provoca rollback.

Isso impede estados parciais como:

``` text
Wallet atualizada + Ledger ausente
```

ou:

``` text
Ledger criado + Wallet não atualizada
```

Não foi criada uma Unit of Work própria. A infraestrutura cria um
`TransactionContext` com repositories ligados ao mesmo `EntityManager`:

``` text
Application Use Case
        ↓
Transaction Manager
        ↓
EntityManager.transactional(tx)
        ↓
Transaction Context
        ├── WalletRepository(tx)
        ├── WagerTransactionRepository(tx)
        ├── WalletLedgerRepository(tx)
        ├── InboxRepository(tx)
        └── OutboxRepository(tx)
```

O `EntityManager` não faz parte dos contratos da camada de aplicação.

------------------------------------------------------------------------

## 10. Concorrência distribuída

A unidade de concorrência financeira é:

``` text
walletId
```

A estratégia escolhida é pessimistic row-level locking no PostgreSQL.

A wallet é carregada dentro da transação utilizando o equivalente a:

``` sql
SELECT ...
FROM wallet
WHERE id = ?
FOR UPDATE;
```

Isso não representa lock global.

``` text
Wallet A → operação 1 mantém o lock
Wallet A → operação 2 aguarda

Wallet B → continua normalmente
Wallet C → continua normalmente
```

Como o lock pertence ao PostgreSQL, a garantia funciona entre processos
e instâncias independentes.

### 10.1 Por que pessimistic locking?

Optimistic locking através de `version` também seria possível, mas
exigiria repetir corretamente toda a unidade financeira quando houvesse
conflito.

Uma operação pode envolver atomicamente Wallet, WagerTransaction,
Ledger, Inbox e Outbox. O lock pessimista torna explícita a serialização
no limite da wallet e simplifica o raciocínio sobre essa unidade.

`Wallet.version` permanece no modelo para representar evolução do
estado, auditoria e diagnóstico, mas não é o mecanismo principal de
concorrência.

### 10.2 Cenário obrigatório

Para:

``` text
saldo inicial = 100.00 BRL

BET A = 80.00 BRL
BET B = 80.00 BRL
```

executadas concorrentemente, os testes de integração contra PostgreSQL
real comprovam:

``` text
1 PROCESSED
1 REJECTED com INSUFFICIENT_BALANCE

saldo final = 20.00 BRL

exatamente 1 lançamento DEBIT
```

------------------------------------------------------------------------

## 11. Idempotência persistente

A memória da aplicação nunca é usada como garantia de idempotência
financeira.

Cada operação persiste:

``` text
idempotencyKey
payloadHash
```

A chave identifica a operação lógica. O hash verifica se uma repetição
representa o mesmo comando de negócio.

O hash é SHA-256 de uma representação canônica contendo apenas:

-   providerId;
-   externalTransactionId;
-   playerId;
-   walletId;
-   roundId;
-   gameId;
-   kind;
-   money.amount;
-   money.currency;
-   referenceExternalTransactionId, quando presente.

Os campos são serializados em ordem determinística.

Metadados de transporte não participam do hash.

O comportamento é:

``` text
chave desconhecida
→ processa

mesma chave + mesmo hash
→ replay idempotente

mesma chave + hash diferente
→ conflito, sem nova alteração financeira
```

Em HTTP, `Idempotency-Key` é a fonte da verdade para a chave de
idempotência.

No SQS existem duas identidades diferentes:

``` text
(consumerName, MessageId)
→ identidade da entrega / Inbox

idempotencyKey + payloadHash
→ identidade financeira / WagerTransaction
```

A deduplicação da Inbox não substitui a idempotência financeira.

### 11.1 Idempotência sob concorrência

O fluxo utiliza camadas complementares:

1.  consulta inicial por `idempotencyKey`;
2.  pessimistic lock da wallet;
3.  nova verificação da idempotência após adquirir o lock;
4.  `UNIQUE(idempotency_key)` como garantia final no PostgreSQL.

A revalidação após o lock impede duplicação para operações concorrentes
na mesma wallet.

A constraint única permanece necessária para proteger corridas
envolvendo a mesma chave submetida para wallets diferentes.

Uma transação perdedora em conflito de unicidade deve sofrer rollback
completo; nenhuma alteração de wallet ou ledger pode sobreviver.

------------------------------------------------------------------------

## 12. Processamento compartilhado entre HTTP e SQS

HTTP e SQS reutilizam a mesma lógica financeira.

`ProcessWagerTransaction.execute()` abre a transação para chamadores
síncronos.

O processamento financeiro também é disponibilizado por:

``` text
executeInContext(TransactionContext, input)
```

Isso permite que um adaptador que já controla uma transação reutilize o
mesmo fluxo sem abrir uma transação independente.

No processamento SQS:

1.  verificar ou registrar a entrega na Inbox;
2.  executar a operação financeira com `executeInContext()`;
3.  marcar a Inbox como processada;
4.  persistir Wallet, WagerTransaction, Ledger e Outbox;
5.  realizar o commit PostgreSQL;
6.  somente depois confirmar a mensagem no SQS.

Se o worker falhar depois do commit e antes do `DeleteMessage`, a
mensagem pode ser reentregue. A Inbox persistente e a idempotência
financeira impedem que o efeito seja aplicado novamente.

------------------------------------------------------------------------

## 13. Contrato SQS e Transactional Inbox

Comandos assíncronos utilizam o contrato `WagerTransactionRequested`.

O corpo contém os dados necessários ao processamento e inclui a
`idempotencyKey` financeira.

O `MessageId` fornecido pelo SQS não é utilizado como chave de
idempotência financeira.

A Inbox utiliza identidade composta:

``` sql
(consumer_name, message_id)
```

Essa identidade é persistente e continua válida após:

-   restart;
-   redelivery;
-   múltiplos workers;
-   múltiplas instâncias.

A mensagem só é confirmada depois do commit da transação PostgreSQL.

O consumer utiliza long polling e participa do ciclo de vida do NestJS.
No shutdown ele deixa de aceitar novos trabalhos e aguarda o loop ativo
terminar.

------------------------------------------------------------------------

## 14. Transactional Outbox

Eventos de integração nunca são publicados antes do commit financeiro.

Os eventos são gravados na Outbox na mesma transação PostgreSQL
responsável pelo estado financeiro.

Depois do commit, um publisher independente processa as mensagens
pendentes.

O payload armazenado é o envelope completo e versionado retornado por
`IntegrationEvent.toJSON()`.

O envelope contém:

``` text
eventId
eventType
aggregateId
correlationId
causationId?
occurredAt
version
data
```

Os eventos implementados incluem:

-   `WagerTransactionProcessed`;
-   `WagerTransactionRejected`;
-   `WalletBalanceChanged`;
-   `WagerTransactionPendingReference`.

O publisher utiliza o snapshot armazenado na Outbox. Ele não reconstrói
o evento consultando novamente Wallet ou WagerTransaction.

### 14.1 Eventos processados e rejeitados

`WagerTransactionProcessed` representa operações aplicadas com sucesso,
inclusive `LOSS`.

`WagerTransactionRejected` representa rejeições de negócio e transporta
um `failureCode` estável. Falhas de infraestrutura não são convertidas
em eventos de rejeição de negócio.

`WalletBalanceChanged` só é emitido quando existe alteração real do
saldo.

`WagerTransactionPendingReference` representa operações que aguardam a
resolução de uma referência ainda ausente.

------------------------------------------------------------------------

## 15. Publishers concorrentes da Outbox

Publishers utilizam claim/lease persistente no PostgreSQL.

Mensagens disponíveis são reivindicadas atomicamente utilizando:

``` text
FOR UPDATE SKIP LOCKED
+
UPDATE ... RETURNING
```

Isso permite múltiplos publishers concorrentes sem lock global.

O fluxo é:

1.  reivindicar atomicamente um lote;
2.  fazer commit do claim/lease;
3.  publicar no SQS fora da transação do banco;
4.  em sucesso, registrar `publishedAt` e liberar o claim;
5.  em falha, incrementar a tentativa, calcular `nextAttemptAt` com
    backoff e liberar o claim.

O I/O de rede não mantém a transação financeira ou o claim SQL aberto.

A garantia é intencionalmente `at-least-once`.

Se a publicação no SQS ocorrer e o publisher falhar antes de registrar
`publishedAt`, o lease expira e o evento pode ser publicado novamente.
Duplicatas são, portanto, parte do modelo de falha e devem ser toleradas
pelos consumidores.

Um teste de integração com PostgreSQL e LocalStack reais inicia dois
publishers independentes com `EntityManager`s separados competindo pela
mesma mensagem e verifica que apenas um publisher a reivindica e publica
naquele ciclo.

------------------------------------------------------------------------

## 16. Filas SQS

Comandos e eventos possuem contratos diferentes e não compartilham a
mesma fila.

A topologia utilizada é:

``` text
wager-transactions.fifo
    → comandos WagerTransactionRequested
    → WagerTransactionConsumer

wager-transactions-dlq.fifo
    → mensagens de comando que excederam a política de redelivery

wager-events.fifo
    → eventos de integração publicados pela Transactional Outbox
```

A separação entre `wager-transactions.fifo` e `wager-events.fifo` impede
que um consumidor de comandos tente interpretar um `IntegrationEvent`
como `WagerTransactionRequested`.

As filas FIFO oferecem ordenação e deduplicação no nível de transporte,
mas essas capacidades são tratadas apenas como salvaguardas adicionais.

A consistência financeira permanece baseada em PostgreSQL, constraints,
Inbox, idempotência persistente e locking por wallet.

### 16.1 Retry e DLQ

Falhas no processamento de comandos não provocam `DeleteMessage`.

Após o visibility timeout, o SQS torna a mensagem visível novamente.

A redrive policy utiliza:

``` text
maxReceiveCount = 5
```

Após falhas repetidas, a mensagem é movida para:

``` text
wager-transactions-dlq.fifo
```

Um teste de integração com LocalStack real envia uma mensagem
deliberadamente inválida, observa cinco tentativas sem confirmação e
verifica sua chegada à DLQ.

------------------------------------------------------------------------

## 17. Health checks e observabilidade operacional

A aplicação disponibiliza:

``` text
GET /live
GET /ready
```

`/live` verifica que o processo está ativo.

`/ready` verifica dependências necessárias para receber trabalho,
atualmente:

-   PostgreSQL;
-   SQS/LocalStack.

A readiness executa uma consulta simples no PostgreSQL e verifica acesso
à fila SQS.

Se uma dependência obrigatória estiver indisponível, o endpoint responde
como não pronto em vez de afirmar falsamente que a aplicação está apta a
processar operações.

Logs do consumer registram processamento, confirmação e falhas de
mensagens.

Métricas, tracing distribuído e dashboards mais completos permanecem
extensões futuras.

------------------------------------------------------------------------

## 18. Autenticação

A autenticação foi intencionalmente adiada porque não faz parte da
pontuação principal do desafio.

A arquitetura mantém espaço para validação da identidade do provider sem
implementar armazenamento próprio de usuários ou senhas.

Uma evolução futura pode utilizar um provedor de identidade externo,
como Zitadel ou Keycloak.

Endpoints de health check permanecem públicos.

------------------------------------------------------------------------

## 19. Estratégia de testes

A estratégia combina testes unitários determinísticos e testes de
integração contra infraestrutura real.

A validação final executada com:

``` bash
bun run test
```

resulta em:

``` text
Test Files  23 passed (23)
Tests       182 passed (182)
```

Os testes cobrem, entre outros pontos:

-   validação e aritmética de `Money`;
-   invariantes e movimentos da `Wallet`;
-   regras de `BET`, `WIN`, `LOSS`, `REFUND` e `ROLLBACK`;
-   transições e estados terminais de `WagerTransaction`;
-   validação de referências;
-   conflitos de moeda;
-   idempotência com payload igual e divergente;
-   persistência e constraints;
-   atomicidade da unidade financeira;
-   Inbox persistente e redelivery;
-   concorrência financeira contra PostgreSQL real;
-   cenário obrigatório de duas BETs concorrentes de 80.00 sobre saldo
    100.00;
-   múltiplas requisições concorrentes para a mesma operação
    idempotente;
-   processamento real de `WagerTransactionRequested` através do
    LocalStack;
-   confirmação SQS somente após processamento transacional;
-   retry e DLQ reais;
-   publishers concorrentes da Outbox;
-   publicação real através do LocalStack;
-   health checks.

Os testes de integração utilizam PostgreSQL e LocalStack reais. As
garantias distribuídas críticas não são comprovadas apenas através de
mocks.

Como alguns testes SQS compartilham filas fixas no mesmo LocalStack, os
arquivos de teste são executados sequencialmente
(`fileParallelism: false`). Isso isola os cenários de infraestrutura sem
remover a concorrência exercitada dentro dos próprios testes. Os testes
específicos de concorrência continuam executando operações simultâneas
explicitamente.

------------------------------------------------------------------------

## 20. Decisões de implementação relevantes

### 20.1 PostgreSQL como autoridade financeira

A correção do saldo, unicidade e concorrência é garantida pelo estado
persistente e por constraints do PostgreSQL, e não por memória local ou
propriedades do broker.

### 20.2 Lock por wallet em vez de lock global

O pessimistic row-level locking permite serializar operações
conflitantes sobre a mesma carteira enquanto carteiras diferentes
continuam processáveis em paralelo.

### 20.3 Inbox e idempotência financeira são garantias diferentes

Inbox deduplica entregas do broker.

`WagerTransaction` deduplica operações financeiras.

Nenhuma delas substitui a outra.

### 20.4 Outbox em vez de publicação antes do commit

A Outbox elimina a janela em que um evento poderia ser publicado apesar
de a transação financeira posteriormente sofrer rollback.

### 20.5 Entrega at-least-once

Sem uma transação distribuída entre PostgreSQL e SQS, exactly-once
end-to-end não é assumido.

O sistema prefere `at-least-once` combinado com deduplicação e
idempotência persistentes.

### 20.6 Separação entre fila de comandos e fila de eventos

`WagerTransactionRequested` e `IntegrationEvent` possuem contratos e
consumidores distintos.

Por isso, comandos entram por `wager-transactions.fifo` e eventos
produzidos pela Outbox são publicados em `wager-events.fifo`.

------------------------------------------------------------------------

## 21. Decisões e extensões ainda pendentes

Os seguintes itens permanecem como extensões ou decisões futuras e não
são necessários para as garantias financeiras centrais já implementadas:

-   quantidade máxima de tentativas para reprocessamento de
    `PENDING_REFERENCE`;
-   TTL de uma transação em `PENDING_REFERENCE`;
-   parâmetros definitivos do backoff para reprocessamento de
    referências;
-   formato final do cursor opaco para paginação do ledger;
-   implementação opcional de autenticação externa;
-   métricas, tracing distribuído e dashboards de observabilidade;
-   políticas operacionais adicionais para retenção e tratamento manual
    de mensagens em DLQ.

As decisões já implementadas --- concorrência financeira, idempotência
persistente, Inbox, Transactional Outbox, concorrência entre publishers,
retry/DLQ do consumer, separação entre filas de comandos e eventos e
health checks --- são descritas nas seções anteriores e não são
consideradas pendentes.

------------------------------------------------------------------------

## 22. Resumo das garantias

A arquitetura final combina:

``` text
Money sem floating point
+
PostgreSQL como fonte de verdade
+
constraints de banco
+
pessimistic row-level locking por wallet
+
idempotência financeira persistente
+
ledger imutável
+
Transactional Inbox
+
Transactional Outbox
+
claim/lease concorrente da Outbox
+
SQS com redelivery e DLQ
+
separação entre comandos e eventos
+
testes reais com PostgreSQL e LocalStack
```

O objetivo é manter a correção financeira mesmo diante de concorrência,
redelivery, múltiplas instâncias e falhas parciais, sem depender de
memória local, locks globais ou garantias de exactly-once fornecidas
pelo broker.
