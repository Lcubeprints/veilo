export async function uploadToIPFS(data: object): Promise<string> {
  const jwt = process.env.PINATA_JWT
  if (!jwt) throw new Error('PINATA_JWT env var is not set')
  const gateway = process.env.PINATA_GATEWAY ?? 'https://gateway.pinata.cloud'

  const res = await fetch('https://api.pinata.cloud/pinning/pinJSONToIPFS', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify({ pinataContent: data }),
  })

  if (!res.ok) throw new Error(`IPFS upload failed: ${res.statusText}`)
  const json: any = await res.json()
  return json.IpfsHash as string
}

export async function fetchFromIPFS(cid: string): Promise<any> {
  const gateway = process.env.PINATA_GATEWAY ?? 'https://gateway.pinata.cloud'
  const res = await fetch(`${gateway}/ipfs/${cid}`)
  if (!res.ok) throw new Error(`IPFS fetch failed: ${cid}`)
  return res.json()
}
