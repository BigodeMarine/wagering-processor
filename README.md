# Distributed Wagering Processor

Serviço backend para processamento distribuído de transações financeiras de apostas, desenvolvido com foco em **correção financeira, segurança em concorrência, idempotência persistente, ledger imutável e processamento assíncrono confiável**.

O projeto foi desenvolvido como desafio técnico utilizando **Bun, TypeScript, NestJS, PostgreSQL, MikroORM, AWS SQS, LocalStack, Docker e Vitest**.

## Arquitetura

A aplicação utiliza uma arquitetura em camadas, separando regras de domínio, casos de uso, persistência, infraestrutura, API HTTP e mensageria.

```text
src/
├── application/
│   ├── errors/
│   ├── ports/
│   └── use-cases/
├── domain/
│   ├── ledger/
│   ├── money/
│   ├── wallet/
│   └── wagering/
├── infrastructure/
│   ├── di/
│   ├── http/
│   ├── ids/
│   ├── messaging/
│   ├── time/
│   └── wagering/
├── migrations/
├── persistence/
├── app.module.ts
└── main.ts
```

As principais decisões arquiteturais e seus trade-offs estão detalhados no arquivo [`ARCHITECTURE.md`](./ARCHITECTURE.md).

## Tecnologias

- Bun 1.x
- TypeScript em modo estrito
- NestJS
- PostgreSQL 16
- MikroORM
- Decimal.js
- AWS SQS
- LocalStack
- Docker
- Docker Compose
- Vitest

## Modelo monetário

Valores monetários não são representados utilizando `number`, `float` ou `double` do JavaScript.

O domínio utiliza `Decimal.js` para operações monetárias e os valores são persistidos no PostgreSQL utilizando `NUMERIC(19,2)`.

Na entrada e saída da aplicação, valores monetários são representados como strings decimais:

```json
{
  "amount": "100.00",
  "currency": "BRL"
}
```

O Value Object `Money` centraliza validação, normalização e operações monetárias.

Essa abordagem evita erros de precisão relacionados a ponto flutuante em operações financeiras.

## Wallet

`Wallet` é o Aggregate Root responsável pelo saldo do jogador.

Entre suas principais invariantes:

- o saldo nunca pode ficar negativo;
- existe apenas uma wallet por `playerId + currency`;
- alterações de saldo passam pelo domínio;
- a versão da wallet é atualizada quando ocorre alteração financeira;
- concorrência financeira é controlada no banco de dados.

Uma wallet é criada internamente com saldo zero.

Quando `initialBalance` é maior que zero, o valor inicial é aplicado através de uma transação financeira explícita do tipo `OPENING`, acompanhada de uma entrada de crédito no ledger.

Dessa forma, o saldo da wallet pode ser explicado pelo seu histórico financeiro.

## Tipos de transação

O domínio suporta:

- `OPENING`
- `BET`
- `WIN`
- `LOSS`
- `REFUND`
- `ROLLBACK`

### BET

Debita o valor da wallet.

### WIN

Credita o valor da wallet.

### LOSS

Registra a transação sem produzir alteração de saldo.

### REFUND

Realiza um crédito associado a uma transação anterior.

### ROLLBACK

Reverte o efeito financeiro de uma transação referenciada.

## Concorrência

A concorrência financeira é controlada através de **pessimistic row-level locking do PostgreSQL** sobre a wallet que está sendo modificada.

Isso evita o padrão inseguro:

```text
ler saldo
calcular novo saldo
atualizar saldo
```

quando múltiplas instâncias tentam alterar a mesma wallet simultaneamente.

Por exemplo, considerando:

```text
saldo inicial = 100.00
```

e duas apostas concorrentes:

```text
BET 80.00
BET 80.00
```

somente uma pode realizar o débito com sucesso.

Resultado esperado:

```text
BET #1 -> PROCESSED
BET #2 -> REJECTED

saldo final -> 20.00
débitos no ledger -> 1
```

A solução não utiliza lock global.

A garantia de concorrência permanece válida mesmo com múltiplas instâncias da aplicação compartilhando o mesmo PostgreSQL.

A propriedade `version` da wallet é mantida para evolução e auditoria do estado, mas não é utilizada como mecanismo principal de controle de concorrência.

## Idempotência persistente

A idempotência das transações financeiras é persistida no PostgreSQL.

Para requisições HTTP, o header:

```http
Idempotency-Key
```

é utilizado como fonte de verdade da identidade da requisição.

A aplicação calcula um hash SHA-256 a partir da representação canônica dos dados de negócio da transação.

Quando a mesma chave e o mesmo payload são enviados novamente, o resultado original é reutilizado:

```text
idempotentReplay = true
```

Nenhum novo movimento financeiro é realizado.

Caso a mesma `Idempotency-Key` seja utilizada com um payload diferente, a operação é rejeitada como conflito de idempotência.

A garantia de idempotência não depende de memória local da aplicação e também não depende exclusivamente das garantias FIFO do SQS.

## Ledger financeiro

Cada movimentação financeira gera um `WalletLedgerEntry`.

O ledger registra informações como:

```text
wallet
transação
tipo de movimento
valor
saldo anterior
saldo posterior
data/hora
```

O ledger é tratado como **append-only** pela aplicação.

Entradas financeiras existentes não são sobrescritas para representar novas operações.

Isso permite manter um histórico auditável entre transações e alterações de saldo.

## Consistência transacional

Operações financeiras relacionadas são executadas dentro de transações do PostgreSQL.

Dependendo do fluxo, uma mesma transação pode envolver:

```text
Wallet
WagerTransaction
WalletLedgerEntry
InboxMessage
OutboxMessage
```

Essas alterações são persistidas atomicamente.

Se uma etapa falhar, a transação é revertida, evitando estados financeiros parcialmente atualizados.

## Inbox Pattern

O processamento assíncrono utiliza uma Inbox persistente.

A Inbox impede que uma mensagem entregue novamente pelo SQS provoque a aplicação duplicada da mesma operação financeira.

O estado da Inbox e a operação financeira são tratados transacionalmente.

Dessa forma, a exclusão da mensagem no SQS não é utilizada como mecanismo principal de idempotência financeira.

## Outbox Pattern

Eventos de integração utilizam o padrão **Transactional Outbox**.

O evento é persistido no PostgreSQL como parte da mesma transação responsável pela alteração financeira.

A publicação ocorre somente após o commit da transação.

Isso evita publicar externamente um evento correspondente a uma alteração financeira que posteriormente poderia sofrer rollback.

O fluxo também possui mecanismos de retry e backoff para publicação.

## AWS SQS

O ambiente local utiliza AWS SQS através do LocalStack.

Filas utilizadas:

```text
wager-transactions.fifo
wager-transactions-dlq.fifo
wager-events.fifo
```

Responsabilidades:

```text
wager-transactions.fifo
    -> comandos de processamento de apostas

wager-transactions-dlq.fifo
    -> mensagens que excederam as tentativas de processamento

wager-events.fifo
    -> eventos de integração produzidos pelo Outbox
```

As garantias FIFO do SQS são utilizadas como recurso operacional, mas **não são consideradas suficientes para garantir correção financeira**.

A correção é garantida através da combinação de:

- transações PostgreSQL;
- constraints no banco;
- row-level locking;
- idempotência persistente;
- Inbox;
- Outbox.

## API HTTP

### Criar wallet

```http
POST /wallets
```

Exemplo:

```json
{
  "playerId": "0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1",
  "currency": "BRL",
  "initialBalance": "100.00"
}
```

Exemplo de resposta:

```json
{
  "id": "d393633e-f3b9-413d-978d-15c76db8ca3d",
  "playerId": "0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1",
  "currency": "BRL",
  "balance": "100.00",
  "version": 2
}
```

A tentativa de criar outra wallet para a mesma combinação `playerId + currency` resulta em conflito.

### Consultar wallet

```http
GET /wallets/:id
```

Retorna o estado atual da wallet.

### Processar transação de aposta

```http
POST /wagering/transactions
```

A requisição exige o header:

```http
Idempotency-Key: <chave-unica>
```

Exemplo de BET:

```json
{
  "providerId": "provider-a",
  "externalTransactionId": "bet-http-001",
  "playerId": "0192f28f-5dc0-7d58-bdb2-814ad6a0f4a1",
  "walletId": "d393633e-f3b9-413d-978d-15c76db8ca3d",
  "roundId": "round-http-001",
  "gameId": "fortune-chimp",
  "kind": "BET",
  "money": {
    "amount": "80.00",
    "currency": "BRL"
  }
}
```

Exemplo de resposta:

```json
{
  "transactionId": "8b40a55d-4bb5-4946-87ea-0544b6eec233",
  "status": "PROCESSED",
  "walletId": "d393633e-f3b9-413d-978d-15c76db8ca3d",
  "balance": {
    "amount": "20.00",
    "currency": "BRL"
  },
  "idempotentReplay": false
}
```

Ao repetir exatamente a mesma requisição utilizando a mesma `Idempotency-Key`, a transação existente é reutilizada sem realizar um segundo débito.

### Health Checks

```http
GET /live
GET /ready
```

`/live` indica que o processo da aplicação está ativo.

`/ready` verifica a disponibilidade das dependências necessárias para operação da aplicação.

## Executando o projeto

### Pré-requisitos

É necessário possuir:

- Bun 1.x
- Docker
- Docker Compose

### Instalar dependências

```bash
bun install
```

### Subir a infraestrutura

```bash
docker compose up -d
```

Verifique os containers:

```bash
docker compose ps
```

O ambiente local utiliza:

- PostgreSQL;
- LocalStack com SQS.

### Variáveis de ambiente

A configuração local utiliza as seguintes informações para PostgreSQL:

```env
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_NAME=wagering
DATABASE_USER=wagering
DATABASE_PASSWORD=wagering
```

### Migrations

Antes de iniciar a aplicação, execute as migrations configuradas pelo MikroORM.

### Iniciar a aplicação

```bash
bun run start:dev
```

A API estará disponível em:

```text
http://localhost:3000
```

## Testes

O projeto possui testes unitários e testes de integração cobrindo regras de domínio e comportamentos críticos da infraestrutura.

Entre os cenários testados estão:

- validações e operações de `Money`;
- débito e crédito de wallet;
- BET;
- WIN;
- LOSS;
- REFUND;
- ROLLBACK;
- conflito de moeda;
- idempotência;
- conflito de idempotência com payload diferente;
- constraints do PostgreSQL;
- rollback transacional;
- persistência atômica;
- Inbox;
- Outbox;
- redelivery de mensagens SQS;
- processamento concorrente;
- duas apostas concorrentes disputando o mesmo saldo;
- criação de wallet;
- saldo inicial através de `OPENING`.

Os testes de integração utilizam **PostgreSQL e LocalStack reais**, evitando mocks justamente nas áreas em que comportamento de banco, concorrência e mensageria são relevantes para a correção da solução.

Para executar:

```bash
bun test
```

## Cenário crítico de concorrência

Um dos cenários de integração valida explicitamente:

```text
Wallet
saldo = 100.00

       ┌── BET 80.00
       │
100.00 ┤
       │
       └── BET 80.00
```

As duas operações são disparadas concorrentemente.

O resultado financeiro esperado é:

```text
1 BET -> PROCESSED
1 BET -> REJECTED
saldo final -> 20.00
1 débito efetivo no ledger
```

Esse teste demonstra que duas requisições concorrentes não conseguem consumir o mesmo saldo.

## Migrations e constraints

A evolução do schema é controlada através de migrations do MikroORM.

As migrations são configuradas de forma transacional.

Além das validações de domínio, invariantes que podem ser expressas no banco de dados também são protegidas por constraints e índices únicos.

Essa estratégia evita depender exclusivamente da camada de aplicação para garantir consistência.

## Princípios da solução

A implementação foi construída respeitando os seguintes princípios:

1. Dinheiro não utiliza ponto flutuante do JavaScript.
2. Idempotência financeira é persistente.
3. SQS FIFO não é a única proteção contra duplicidade.
4. Eventos não são publicados antes do commit financeiro.
5. O ledger mantém histórico imutável.
6. Não existe lock global.
7. Alterações de saldo possuem controle explícito de concorrência.
8. A correção financeira não depende de uma única instância da aplicação.
9. Constraints do banco reforçam invariantes do domínio.
10. Processamento HTTP e assíncrono compartilham as mesmas regras financeiras.

## Autenticação

A implementação de autenticação foi intencionalmente mantida fora do núcleo da solução.

Em um ambiente de produção, a identidade seria preferencialmente delegada a um Identity Provider externo, mantendo autenticação separada das regras financeiras do domínio.

Essa decisão permite concentrar a implementação nas garantias críticas do desafio: correção financeira, concorrência, idempotência e processamento distribuído.

## Melhorias futuras

Com tempo adicional de desenvolvimento, os próximos passos seriam:

- endpoints adicionais para consulta de transações;
- consulta do ledger com paginação por cursor estável e opaco;
- endpoint de reconciliação;
- worker para reprocessamento de transações aguardando referência;
- ampliação de logs estruturados e métricas;
- testes adicionais com múltiplos processos da aplicação;
- maior cobertura end-to-end da API HTTP;
- hardening operacional do publisher do Outbox.

Esses itens são apresentados como evoluções futuras e não como funcionalidades concluídas.

## Decisões arquiteturais

A justificativa detalhada das principais decisões técnicas está disponível em:

[`ARCHITECTURE.md`](./ARCHITECTURE.md)

O documento aborda, entre outros pontos:

- modelagem monetária;
- concorrência;
- pessimistic locking;
- idempotência;
- ledger;
- Inbox;
- Outbox;
- SQS;
- transações;
- constraints;
- testes;
- trade-offs arquiteturais.


**Edson Garcia **

Desenvolvedor Backend / Full Stack
