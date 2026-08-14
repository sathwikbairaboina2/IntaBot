import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
export declare const tableMain: string;
export declare const tableCheckpoints: string;
export declare const rawClient: DynamoDBClient;
export declare const docClient: DynamoDBDocumentClient;
/** Ensures both tables exist and are empty. Call in beforeEach. */
export declare function resetTables(): Promise<void>;
