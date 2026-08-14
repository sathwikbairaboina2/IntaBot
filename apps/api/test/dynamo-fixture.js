"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.docClient = exports.rawClient = exports.tableCheckpoints = exports.tableMain = void 0;
exports.resetTables = resetTables;
const client_dynamodb_1 = require("@aws-sdk/client-dynamodb");
const lib_dynamodb_1 = require("@aws-sdk/lib-dynamodb");
const bootstrap_1 = require("../src/dynamo/bootstrap");
exports.tableMain = process.env.DYNAMO_TABLE_MAIN;
exports.tableCheckpoints = process.env.DYNAMO_TABLE_CHECKPOINTS;
exports.rawClient = new client_dynamodb_1.DynamoDBClient({
    region: process.env.AWS_REGION,
    endpoint: process.env.DYNAMO_ENDPOINT,
    credentials: { accessKeyId: "local", secretAccessKey: "local" },
});
exports.docClient = lib_dynamodb_1.DynamoDBDocumentClient.from(exports.rawClient, {
    marshallOptions: { removeUndefinedValues: true },
});
// Tables are created once per worker, not once per test. Dropping and
// recreating them in beforeEach made the suite slow and intermittently
// flaky: DynamoDB Local's DeleteTable/CreateTable polling can stall for
// ~20s, and concurrent recreation races. Emptying the items is both
// deterministic and fast.
let tablesReady = null;
async function ensureOnce() {
    tablesReady ??= (0, bootstrap_1.ensureTables)(exports.rawClient, { main: exports.tableMain, checkpoints: exports.tableCheckpoints });
    return tablesReady;
}
async function clearTable(table) {
    for (;;) {
        const scan = await exports.docClient.send(new lib_dynamodb_1.ScanCommand({ TableName: table, ProjectionExpression: "PK, SK" }));
        const items = scan.Items ?? [];
        if (items.length === 0)
            return;
        for (let i = 0; i < items.length; i += 25) {
            await exports.docClient.send(new lib_dynamodb_1.BatchWriteCommand({
                RequestItems: {
                    [table]: items.slice(i, i + 25).map((Key) => ({ DeleteRequest: { Key } })),
                },
            }));
        }
        if (!scan.LastEvaluatedKey)
            return;
    }
}
/** Ensures both tables exist and are empty. Call in beforeEach. */
async function resetTables() {
    await ensureOnce();
    await Promise.all([clearTable(exports.tableMain), clearTable(exports.tableCheckpoints)]);
}
//# sourceMappingURL=dynamo-fixture.js.map