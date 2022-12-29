import { ShardusTypes } from '@shardus/core'
import * as crypto from '@shardus/crypto-utils'
import { BN, isValidAddress } from 'ethereumjs-util'
import { Request } from 'express'
import { toShardusAddress } from '../shardeum/evmAddress'
import { AccountType, WrappedEVMAccount } from '../shardeum/shardeumTypes'
import { fixDeserializedWrappedEVMAccount } from '../shardeum/wrappedEVMAccountFunctions'

// types

export interface QueryCertRequest {
  nominee: string
  nominator: string
  sign?: ShardusTypes.Sign
}

export type CertSignaturesResult = {
  success: boolean
  signedStakeCert?: StakeCert
}

export interface StakeCert {
  nominator: string
  nominee: string
  stake: BN
  certExp: number
  signs?: ShardusTypes.Sign[]
}

export interface ValidatorError {
  success: boolean
  reason: string
}

function validateQueryCertRequest(req: QueryCertRequest, rawBody: any): ValidatorError {
  if (!isValidAddress(req.nominee)) {
    return { success: false, reason: 'Invalid nominee address' }
  }
  if (!isValidAddress(req.nominator)) {
    return { success: false, reason: 'Invalid nominator address' }
  }
  try {
    if (!crypto.verifyObj(rawBody)) return { success: false, reason: 'Invalid signature for QueryCert tx' }
  } catch (e) {
    return { success: false, reason: 'Invalid signature for QueryCert tx' }
  }

  return { success: true, reason: '' }
}

export async function queryCertificateHandler(
  req: Request,
  shardus: any
): Promise<CertSignaturesResult | ValidatorError> {
  const queryCertReq = req.body as QueryCertRequest
  const reqValidationResult = validateQueryCertRequest(queryCertReq, req.body)
  if (!reqValidationResult.success) return reqValidationResult

  const operatorAccount = await getEVMAccountDataForAddress(shardus, queryCertReq.nominator)
  if (!operatorAccount) return { success: false, reason: 'Failed to fetch operator account state' }
  const nodeAccount = await getEVMAccountDataForAddress(shardus, queryCertReq.nominee)
  if (!nodeAccount) return { success: false, reason: 'Failed to fetch node account state' }

  const currentTimestamp = Math.round(Date.now() / 1000)

  // check operator cert validity
  if (operatorAccount.operatorAccountInfo.certExp > currentTimestamp)
    return {
      success: false,
      reason: 'Operator certificate has expired',
    }

  return await getCertSignatures(shardus, {
    nominator: queryCertReq.nominator,
    nominee: queryCertReq.nominee,
    stake: operatorAccount.operatorAccountInfo.stake,
    certExp: operatorAccount.operatorAccountInfo.certExp,
  })
}

async function getEVMAccountDataForAddress(
  shardus: any,
  evmAddress: string
): Promise<WrappedEVMAccount | undefined> {
  const shardusAddress = toShardusAddress(evmAddress, AccountType.Account)
  const account = await shardus.getLocalOrRemoteAccount(shardusAddress)
  if (!account) return undefined
  let data = account.data
  fixDeserializedWrappedEVMAccount(data)
  return data
}

export async function getCertSignatures(shardus: any, certData: StakeCert): Promise<CertSignaturesResult> {
  const signedAppData = await shardus.getAppDataSignatures(
    'sign-app-data',
    crypto.hashObj(certData),
    5,
    certData
  )
  if (!signedAppData.success) {
    return {
      success: false,
    }
  }
  certData.signs = signedAppData.signatures
  return { success: true, signedStakeCert: certData }
}